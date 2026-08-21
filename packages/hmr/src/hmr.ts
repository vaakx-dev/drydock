import { watch as watchFiles, type FSWatcher } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import { ReloadUnsupportedError, type Loader, type PluginEntry } from "@drydock/loader";

export type FilePath = string | URL;

export type HmrFailurePhase = "watch" | "sources" | "reload";

export interface HmrFailure {
  readonly phase: HmrFailurePhase;
  readonly error: unknown;
  readonly entries: readonly string[];
  readonly files: readonly string[];
}

export interface HmrOptions {
  readonly roots: readonly FilePath[];
  readonly sources: (entry: PluginEntry) => readonly FilePath[];
  readonly debounceMs?: number;
  readonly extensions?: readonly string[];
  readonly ignore?: (path: string) => boolean;
  readonly onError?: (failure: HmrFailure) => void;
}

export type HmrState = "open" | "closing" | "closed";

export interface HmrWatcher {
  readonly state: HmrState;
  refresh(): void;
  close(): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 50;
const DEFAULT_EXTENSIONS = [
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".json",
  ".jsonc",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
] as const;

interface PendingChanges {
  all: boolean;
  files: Set<string>;
}

export function watch(loader: Loader, options: HmrOptions): HmrWatcher {
  return new FileWatcher(loader, options);
}

class FileWatcher implements HmrWatcher {
  readonly #loader: Loader;
  readonly #roots: readonly string[];
  readonly #sources: HmrOptions["sources"];
  readonly #debounceMs: number;
  readonly #extensions: ReadonlySet<string>;
  readonly #ignore: HmrOptions["ignore"];
  readonly #onError: HmrOptions["onError"];
  readonly #watchers: FSWatcher[] = [];
  #sourceIndex = new Map<string, Set<string>>();
  readonly #pending: PendingChanges = { all: false, files: new Set() };
  #state: HmrState = "open";
  #timer: ReturnType<typeof setTimeout> | undefined;
  #queue = Promise.resolve();
  #closing: Promise<void> | undefined;

  constructor(loader: Loader, options: HmrOptions) {
    if (!loader.supportsReload) throw new ReloadUnsupportedError();
    if (options.roots.length === 0) throw new Error("at least one HMR root is required");
    if (!Number.isFinite(options.debounceMs ?? DEFAULT_DEBOUNCE_MS)) {
      throw new TypeError("HMR debounce must be finite");
    }
    if ((options.debounceMs ?? DEFAULT_DEBOUNCE_MS) < 0) {
      throw new RangeError("HMR debounce cannot be negative");
    }

    this.#loader = loader;
    this.#roots = [...new Set(options.roots.map(canonicalPath))];
    this.#sources = options.sources;
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#extensions = new Set((options.extensions ?? DEFAULT_EXTENSIONS).map(normalizeExtension));
    this.#ignore = options.ignore;
    this.#onError = options.onError;

    this.refresh();
    try {
      for (const root of this.#roots) {
        const watcher = watchFiles(root, { recursive: true }, (_event, filename) => {
          this.#changed(root, filename);
        });
        watcher.on("error", (error) => {
          this.#reportFailure("watch", error, [], []);
        });
        this.#watchers.push(watcher);
      }
    } catch (error) {
      for (const watcher of this.#watchers) watcher.close();
      this.#state = "closed";
      throw error;
    }
  }

  get state(): HmrState {
    return this.#state;
  }

  refresh(): void {
    if (this.#state !== "open") return;
    const sourceIndex = new Map<string, Set<string>>();
    for (const entry of this.#loader.entries) {
      if (entry.disabled) continue;
      for (const source of this.#sources(entry)) {
        const path = canonicalPath(source);
        const entries = sourceIndex.get(path) ?? new Set<string>();
        entries.add(entry.id);
        sourceIndex.set(path, entries);
      }
    }
    this.#sourceIndex = sourceIndex;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#state = "closing";
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#pending.all = false;
    this.#pending.files.clear();
    for (const watcher of this.#watchers) watcher.close();
    this.#closing = this.#queue.then(() => {
      this.#state = "closed";
    });
    return this.#closing;
  }

  #changed(root: string, filename: string | Buffer | null): void {
    if (this.#state !== "open") return;
    if (filename === null) {
      this.#pending.all = true;
    } else {
      const path = canonicalPath(joinPath(root, String(filename)));
      try {
        if (!this.#shouldWatch(path)) return;
      } catch (error) {
        this.#reportFailure("watch", error, [], [path]);
        return;
      }
      this.#pending.files.add(path);
    }
    this.#schedule();
  }

  #shouldWatch(path: string): boolean {
    if (this.#ignore?.(path)) return false;
    const extension = fileExtension(path);
    return this.#extensions.size === 0 || this.#extensions.has(extension);
  }

  #schedule(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#flush();
    }, this.#debounceMs);
  }

  async #flush(): Promise<void> {
    if (this.#state !== "open") return;
    const changes = {
      all: this.#pending.all,
      files: new Set(this.#pending.files),
    };
    this.#pending.all = false;
    this.#pending.files.clear();

    const entries = this.#affectedEntries(changes);
    if (entries.length === 0) return;
    const files = [...changes.files];
    const operation = this.#queue.then(async () => {
      const failures: unknown[] = [];
      for (const id of entries) {
        try {
          await this.#loader.reload(id);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        this.#reportFailure("reload", failures.length === 1
          ? failures[0]
          : new AggregateError(failures, "HMR reload failed"), entries, files);
      }
      try {
        this.refresh();
      } catch (error) {
        this.#reportFailure("sources", error, entries, files);
      }
    });
    this.#queue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  #affectedEntries(changes: PendingChanges): readonly string[] {
    const active = this.#loader.entries.filter((entry) => !entry.disabled);
    if (changes.all) return active.map((entry) => entry.id);

    const ids = new Set<string>();
    for (const file of changes.files) {
      for (const id of this.#sourceIndex.get(file) ?? []) ids.add(id);
      if (this.#sourceIndex.has(file)) continue;
      if (this.#roots.some((root) => isWithin(file, root))) {
        for (const entry of active) ids.add(entry.id);
      }
    }
    return [...ids];
  }

  #reportFailure(
    phase: HmrFailurePhase,
    error: unknown,
    entries: readonly string[],
    files: readonly string[],
  ): void {
    try {
      this.#onError?.({ phase, error, entries, files });
    } catch {
      // Error observers cannot interrupt the watcher queue.
    }
  }
}

function canonicalPath(value: FilePath): string {
  const raw = value instanceof URL ? fileURLToPath(value) : value;
  const absolute = isAbsolute(raw) || isWindowsAbsolute(raw) ? raw : resolve(raw);
  const normalized = normalize(absolute);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function joinPath(root: string, filename: string): string {
  return `${root.replace(/[\\/]+$/u, "")}${sep}${filename}`;
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function isWindowsAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(path);
}

function normalizeExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function fileExtension(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}
