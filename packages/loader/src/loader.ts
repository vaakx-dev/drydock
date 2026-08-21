import {
  type Context,
  type Dispose,
} from "@drydock/core";

import {
  activate,
  assertGeneration,
  disposeGeneration,
  settleGeneration,
  snapshotOf,
  validateDefinition,
  type Definition,
  type RuntimeEntry,
} from "./generation.js";
import {
  copyEntries,
  copyEntry,
  flattenConfig,
  inGroup,
  insertConfig,
  replaceConfig,
  validateEntries,
  withoutConfig,
} from "./configuration.js";
import { ReloadUnsupportedError } from "./errors.js";
import { Observers } from "./observers.js";
import type {
  LoaderConfig,
  LoaderSnapshot,
  LoaderState,
  PluginEntry,
  PluginGroup,
  PluginResolver,
  ReloadablePluginResolver,
} from "./types.js";
import { isReloadablePluginResolver } from "./types.js";

export class Loader {
  readonly #observers = new Observers<LoaderState>();
  readonly #contextDispose: Dispose;
  #state: LoaderState = { status: "idle" };
  #generation: RuntimeEntry[] = [];
  #entries: readonly PluginEntry[] | undefined;
  #queue = Promise.resolve();
  #closed = false;
  #closing: Promise<void> | undefined;
  #closeReason: unknown;

  constructor(
    private readonly context: Context,
    private readonly resolve: PluginResolver,
  ) {
    this.#contextDispose = context.effect(() => (
      this.#beginClose(this.#closeReason ?? context.signal.reason)
    ));
  }

  get state(): LoaderState {
    return this.#state;
  }

  get entries(): readonly PluginEntry[] {
    return copyEntries(this.#entries ?? []);
  }

  get supportsReload(): boolean {
    return isReloadablePluginResolver(this.resolve);
  }

  subscribe(
    listener: (state: LoaderState) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    return this.#observers.subscribe(listener, onError);
  }

  load(config: readonly LoaderConfig[]): Promise<LoaderSnapshot> {
    return this.#enqueue(() => this.#load(flattenConfig(config)));
  }

  set(entry: PluginEntry): Promise<LoaderSnapshot> {
    return this.#enqueue(() => this.#set(entry));
  }

  setGroup(group: PluginGroup): Promise<LoaderSnapshot> {
    return this.#enqueue(() => this.#setGroup(group));
  }

  removeGroup(id: string, reason?: unknown): Promise<number> {
    return this.#enqueue(() => this.#removeGroup(id, reason));
  }

  reload(id?: string): Promise<LoaderSnapshot> {
    return this.#enqueue(() => (
      id === undefined ? this.#reloadAll(this.#entries) : this.#reloadEntry(id)
    ));
  }

  unload(id: string, reason?: unknown): Promise<boolean> {
    return this.#enqueue(() => this.#unload(id, reason));
  }

  close(reason?: unknown): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closeReason = reason;
    return this.#contextDispose();
  }

  #beginClose(reason?: unknown): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closing = this.#enqueue(async () => {
      if (this.#closed) return;
      this.#closed = true;
      const generation = this.#generation;
      this.#generation = [];
      this.#entries = undefined;
      let disposal: { readonly status: "ok" } | { readonly status: "failed"; error: unknown }
        = { status: "ok" };
      try {
        await disposeGeneration(generation, reason);
      } catch (error) {
        disposal = { status: "failed", error };
      }
      this.#setState({ status: "closed" });
      if (disposal.status === "failed") throw disposal.error;
    });
    return this.#closing;
  }

  async #reloadAll(entries: readonly PluginEntry[] | undefined): Promise<LoaderSnapshot> {
    if (this.#closed) throw new Error("loader is closed");
    if (!entries) throw new Error("loader has no configuration to reload");
    const resolver = this.#reloadResolver();
    validateEntries(entries);

    try {
      const specifiers = new Set(entries
        .filter((entry) => !entry.disabled)
        .map((entry) => entry.use));
      for (const specifier of specifiers) await resolver.invalidate(specifier);
    } catch (error) {
      this.#setState({ status: "failed", error, snapshot: snapshotOf(this.#generation) });
      throw error;
    }

    return this.#load(entries);
  }

  async #reloadEntry(id: string): Promise<LoaderSnapshot> {
    if (this.#closed) throw new Error("loader is closed");
    if (!this.#entries) throw new Error("loader has no configuration to reload");
    const resolver = this.#reloadResolver();
    const entry = this.#entries.find((candidate) => candidate.id === id && !candidate.disabled);
    if (!entry) throw new Error(`plugin entry is not active: ${id}`);
    const index = this.#generation.findIndex((candidate) => candidate.entry.id === id);
    if (index < 0) throw new Error(`plugin entry is not active: ${id}`);
    this.#setState({ status: "loading" });

    let definition: Definition;
    try {
      await resolver.invalidate(entry.use);
      definition = { entry, plugin: await this.resolve(entry.use) };
      validateDefinition(definition);
    } catch (error) {
      this.#setState({ status: "failed", error, snapshot: snapshotOf(this.#generation) });
      throw error;
    }

    return this.#replaceEntry(index, definition);
  }

  async #unload(id: string, reason?: unknown): Promise<boolean> {
    if (this.#closed) throw new Error("loader is closed");
    if (!this.#entries?.some((entry) => entry.id === id)) return false;
    const index = this.#generation.findIndex((candidate) => candidate.entry.id === id);
    this.#setState({ status: "loading" });
    let disposal: { readonly status: "ok" } | { readonly status: "failed"; readonly error: unknown }
      = { status: "ok" };
    if (index >= 0) {
      const runtime = this.#generation[index]!;
      try {
        await runtime.mounted.dispose(
          reason ?? new Error(`plugin unloaded: ${id}`),
        );
      } catch (error) {
        disposal = { status: "failed", error };
      }
      this.#generation.splice(index, 1);
    }
    this.#entries = withoutConfig(this.#entries, id);
    const snapshot = snapshotOf(this.#generation);
    if (disposal.status === "failed") {
      this.#setState({ status: "failed", error: disposal.error, snapshot });
      throw disposal.error;
    }
    this.#setState({ status: "active", snapshot });
    return true;
  }

  async #set(entry: PluginEntry): Promise<LoaderSnapshot> {
    if (this.#closed) throw new Error("loader is closed");
    validateEntries([entry]);
    if (!this.#entries) return this.#load([entry]);
    const configIndex = this.#entries.findIndex((candidate) => candidate.id === entry.id);
    if (configIndex < 0) return this.#activateEntry(entry, this.#entries.length, false);

    const previous = this.#entries[configIndex]!;
    const runtimeIndex = this.#generation.findIndex((candidate) => candidate.entry.id === entry.id);
    if (previous.disabled) {
      if (entry.disabled) {
        this.#entries = replaceConfig(this.#entries, configIndex, entry);
        return this.#activateState();
      }
      return this.#activateEntry(entry, configIndex, true);
    }
    if (runtimeIndex < 0) throw new Error(`plugin entry is not active: ${entry.id}`);
    if (entry.disabled) return this.#disableEntry(runtimeIndex, configIndex, entry);

    if (previous.use !== entry.use) {
      this.#setState({ status: "loading" });
      let definition: Definition;
      try {
        definition = { entry: copyEntry(entry), plugin: await this.resolve(entry.use) };
        validateDefinition(definition);
      } catch (error) {
        this.#setState({ status: "failed", error, snapshot: snapshotOf(this.#generation) });
        throw error;
      }
      await this.#replaceEntry(runtimeIndex, definition);
      const configured = copyEntry(entry);
      this.#entries = replaceConfig(this.#entries, configIndex, configured);
      this.#generation[runtimeIndex] = {
        ...this.#generation[runtimeIndex]!,
        entry: configured,
      };
      return this.#activateState();
    }

    const configured = copyEntry(entry);
    const runtime = this.#generation[runtimeIndex]!;
    if (Object.is(previous.config, entry.config)) {
      this.#entries = replaceConfig(this.#entries, configIndex, configured);
      this.#generation[runtimeIndex] = { ...runtime, entry: configured };
      return this.#activateState();
    }

    this.#setState({ status: "loading" });
    try {
      await runtime.mounted.update(entry.config);
      this.#entries = replaceConfig(this.#entries, configIndex, configured);
      this.#generation[runtimeIndex] = { ...runtime, entry: configured };
      return this.#activateState();
    } catch (error) {
      let failure = error;
      if (runtime.mounted.state.status === "failed") {
        try {
          await runtime.mounted.dispose(error);
        } catch (cleanupError) {
          failure = new AggregateError(
            [error, cleanupError],
            `plugin update cleanup failed: ${entry.id}`,
          );
        }
        this.#generation.splice(runtimeIndex, 1);
        this.#entries = withoutConfig(this.#entries, entry.id);
      }
      const snapshot = snapshotOf(this.#generation);
      this.#setState({ status: "failed", error: failure, snapshot });
      throw failure;
    }
  }

  async #setGroup(group: PluginGroup): Promise<LoaderSnapshot> {
    if (this.#closed) throw new Error("loader is closed");
    const configured = flattenConfig([group]);
    const id = group.id.trim();
    const expected = new Set(configured.map((entry) => entry.id));
    const removed = (this.#entries ?? [])
      .filter((entry) => inGroup(entry, id) && !expected.has(entry.id))
      .reverse();
    for (const entry of removed) await this.#unload(entry.id);
    for (const entry of configured) await this.#set(entry);
    return this.#activateState();
  }

  async #removeGroup(id: string, reason?: unknown): Promise<number> {
    if (this.#closed) throw new Error("loader is closed");
    const group = id.trim();
    if (!group) throw new Error("plugin group id is required");
    const entries = (this.#entries ?? []).filter((entry) => inGroup(entry, group)).reverse();
    for (const entry of entries) await this.#unload(entry.id, reason);
    return entries.length;
  }

  async #activateEntry(
    entry: PluginEntry,
    configIndex: number,
    replace: boolean,
  ): Promise<LoaderSnapshot> {
    this.#setState({ status: "loading" });
    const configured = copyEntry(entry);
    let runtime: RuntimeEntry | undefined;
    try {
      const definition = { entry: configured, plugin: await this.resolve(entry.use) };
      validateDefinition(definition);
      [runtime] = await activate(this.context, [definition]);
      if (!runtime) throw new Error(`plugin did not activate: ${entry.id}`);
      const nextEntries = replace
        ? replaceConfig(this.#entries!, configIndex, configured)
        : insertConfig(this.#entries!, configIndex, configured);
      const runtimeIndex = nextEntries
        .slice(0, configIndex)
        .filter((candidate) => !candidate.disabled)
        .length;
      const generation = [...this.#generation];
      generation.splice(runtimeIndex, 0, runtime);
      await settleGeneration(generation);
      assertGeneration(generation);
      this.#entries = nextEntries;
      this.#generation = generation;
      return this.#activateState();
    } catch (error) {
      const errors = [error];
      try {
        if (runtime) {
          await runtime.mounted.dispose(error);
        }
        await settleGeneration(this.#generation);
        assertGeneration(this.#generation);
      } catch (rollbackError) {
        errors.push(rollbackError);
      }
      const failure = errors.length === 1
        ? error
        : new AggregateError(errors, `plugin activation rollback failed: ${entry.id}`);
      this.#setState({ status: "failed", error: failure, snapshot: snapshotOf(this.#generation) });
      throw failure;
    }
  }

  async #disableEntry(
    runtimeIndex: number,
    configIndex: number,
    entry: PluginEntry,
  ): Promise<LoaderSnapshot> {
    this.#setState({ status: "loading" });
    const runtime = this.#generation[runtimeIndex]!;
    let disposal: { readonly status: "ok" } | { readonly status: "failed"; error: unknown }
      = { status: "ok" };
    try {
      await runtime.mounted.dispose(new Error(`plugin disabled: ${entry.id}`));
    } catch (error) {
      disposal = { status: "failed", error };
    }
    this.#generation.splice(runtimeIndex, 1);
    this.#entries = replaceConfig(this.#entries!, configIndex, entry);
    const snapshot = snapshotOf(this.#generation);
    if (disposal.status === "failed") {
      this.#setState({ status: "failed", error: disposal.error, snapshot });
      throw disposal.error;
    }
    this.#setState({ status: "active", snapshot });
    return snapshot;
  }

  #activateState(): LoaderSnapshot {
    const snapshot = snapshotOf(this.#generation);
    this.#setState({ status: "active", snapshot });
    return snapshot;
  }

  async #replaceEntry(index: number, definition: Definition): Promise<LoaderSnapshot> {
    const previous = this.#generation[index];
    if (!previous) throw new Error(`plugin entry is not active: ${definition.entry.id}`);
    let replacement: RuntimeEntry | undefined;
    try {
      await previous.mounted.dispose(new Error(`plugin reloaded: ${definition.entry.id}`));
      [replacement] = await activate(this.context, [definition]);
      if (!replacement) throw new Error(`plugin did not activate: ${definition.entry.id}`);
      this.#generation[index] = replacement;
      await settleGeneration(this.#generation);
      assertGeneration(this.#generation);
      const snapshot = snapshotOf(this.#generation);
      this.#setState({ status: "active", snapshot });
      return snapshot;
    } catch (error) {
      const errors = [error];
      if (replacement) {
        try {
          await replacement.mounted.dispose(error);
        } catch (cleanupError) {
          errors.push(cleanupError);
        }
      }
      try {
        const [restored] = await activate(this.context, [{
          entry: previous.entry,
          plugin: previous.plugin,
        }]);
        if (!restored) throw new Error(`plugin rollback did not activate: ${previous.entry.id}`);
        this.#generation[index] = restored;
        await settleGeneration(this.#generation);
        assertGeneration(this.#generation);
      } catch (rollbackError) {
        this.#generation.splice(index, 1);
        if (this.#entries) this.#entries = withoutConfig(this.#entries, definition.entry.id);
        errors.push(rollbackError);
      }
      const failure = errors.length === 1
        ? error
        : new AggregateError(errors, `plugin reload and rollback failed: ${definition.entry.id}`);
      const snapshot = snapshotOf(this.#generation);
      this.#setState({ status: "failed", error: failure, snapshot });
      throw failure;
    }
  }

  async #load(entries: readonly PluginEntry[]): Promise<LoaderSnapshot> {
    if (this.#closed) throw new Error("loader is closed");
    validateEntries(entries);
    this.#setState({ status: "loading" });
    let definitions: Definition[];
    try {
      definitions = await Promise.all(entries
        .filter((entry) => !entry.disabled)
        .map(async (entry): Promise<Definition> => ({
          entry,
          plugin: await this.resolve(entry.use),
        })));
      definitions.forEach(validateDefinition);
    } catch (error) {
      const snapshot = snapshotOf(this.#generation);
      this.#setState({ status: "failed", error, snapshot });
      throw error;
    }

    const previousDefinitions = this.#generation.map(({ entry, plugin }) => ({ entry, plugin }));
    const previous = this.#generation;
    this.#generation = [];
    try {
      await disposeGeneration(previous, new Error("loader configuration replaced"));
      this.#generation = await activate(this.context, definitions);
      this.#entries = copyEntries(entries);
      const snapshot = snapshotOf(this.#generation);
      this.#setState({ status: "active", snapshot });
      return snapshot;
    } catch (error) {
      let failure = error;
      try {
        this.#generation = await activate(this.context, previousDefinitions);
      } catch (rollbackError) {
        this.#generation = [];
        this.#entries = undefined;
        failure = new AggregateError(
          [error, rollbackError],
          "loader update and rollback both failed",
        );
      }
      const snapshot = snapshotOf(this.#generation);
      this.#setState({ status: "failed", error: failure, snapshot });
      throw failure;
    }
  }

  #enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#queue.then(operation);
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }

  #reloadResolver(): ReloadablePluginResolver {
    if (!isReloadablePluginResolver(this.resolve)) throw new ReloadUnsupportedError();
    return this.resolve;
  }

  #setState(state: LoaderState): void {
    this.#state = state;
    this.#observers.emit(state);
  }
}
