import { contextIdentity, type Context } from "./context.js";
import type { MountedPlugin, MountState, Plugin } from "./plugin.js";
import { Observers } from "./observers.js";
import type { EffectSnapshot } from "./scope.js";

interface Runtime {
  readonly id: number;
  readonly mounted: MountedPlugin;
  readonly plugin: Plugin<any, any>;
  unsubscribe(): void;
}

export interface RegisteredPlugin {
  readonly id: number;
  readonly name: string;
  readonly state: MountState;
  readonly effects: readonly EffectSnapshot[];
}

export interface RegistrySnapshot {
  readonly plugins: readonly RegisteredPlugin[];
}

const REGISTER = Symbol("drydock.registry.register");
const registries = new WeakMap<object, RuntimeRegistry>();

export interface Registry {
  readonly size: number;
  readonly snapshot: RegistrySnapshot;
  get(id: number): MountedPlugin | undefined;
  id(mounted: MountedPlugin): number | undefined;
  mounts(plugin: Plugin<any, any>): readonly MountedPlugin[];
  restart(id: number): boolean;
  restartAll(plugin: Plugin<any, any>): number;
  dispose(id: number, reason?: unknown): Promise<boolean>;
  disposeAll(plugin: Plugin<any, any>, reason?: unknown): Promise<number>;
  subscribe(
    listener: (snapshot: RegistrySnapshot) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}

class RuntimeRegistry implements Registry {
  readonly #observers = new Observers<RegistrySnapshot>();
  readonly #runtimes = new Map<number, Runtime>();
  readonly #ids = new WeakMap<MountedPlugin, number>();
  readonly #plugins = new WeakMap<object, Set<number>>();
  #nextId = 1;

  get size(): number {
    return this.#runtimes.size;
  }

  get snapshot(): RegistrySnapshot {
    return {
      plugins: [...this.#runtimes.values()].map(({ id, mounted }) => ({
        id,
        name: mounted.name,
        state: mounted.state,
        effects: mounted.effects,
      })),
    };
  }

  get(id: number): MountedPlugin | undefined {
    return this.#runtimes.get(id)?.mounted;
  }

  id(mounted: MountedPlugin): number | undefined {
    return this.#ids.get(mounted);
  }

  mounts(plugin: Plugin<any, any>): readonly MountedPlugin[] {
    return [...this.#plugins.get(plugin) ?? []].flatMap((id) => {
      const mounted = this.#runtimes.get(id)?.mounted;
      return mounted ? [mounted] : [];
    });
  }

  restart(id: number): boolean {
    const mounted = this.get(id);
    if (!mounted) return false;
    mounted.restart();
    return true;
  }

  restartAll(plugin: Plugin<any, any>): number {
    const mounts = this.mounts(plugin);
    for (const mounted of mounts) mounted.restart();
    return mounts.length;
  }

  async dispose(id: number, reason?: unknown): Promise<boolean> {
    const mounted = this.get(id);
    if (!mounted) return false;
    await mounted.dispose(reason);
    return true;
  }

  async disposeAll(plugin: Plugin<any, any>, reason?: unknown): Promise<number> {
    const mounts = this.mounts(plugin);
    const results = await Promise.allSettled(mounts.map((mounted) => mounted.dispose(reason)));
    const failures = results.flatMap((result) => (
      result.status === "rejected" ? [result.reason] : []
    ));
    if (failures.length > 0) {
      throw new AggregateError(failures, `plugin cleanup failed: ${plugin.name}`);
    }
    return mounts.length;
  }

  subscribe(
    listener: (snapshot: RegistrySnapshot) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    return this.#observers.subscribe(listener, onError);
  }

  [REGISTER](mounted: MountedPlugin, plugin: Plugin<any, any>): void {
    if (this.#ids.has(mounted)) return;
    const id = this.#nextId;
    this.#nextId += 1;
    const runtime: Runtime = {
      id,
      mounted,
      plugin,
      unsubscribe: () => undefined,
    };
    runtime.unsubscribe = mounted.subscribe((state) => {
      if (state.status === "disposed") this.#remove(runtime);
      else this.#emit();
    });
    this.#runtimes.set(id, runtime);
    this.#ids.set(mounted, id);
    const mounts = this.#plugins.get(plugin) ?? new Set();
    mounts.add(id);
    this.#plugins.set(plugin, mounts);
    this.#emit();
  }

  #remove(runtime: Runtime): void {
    if (this.#runtimes.get(runtime.id) !== runtime) return;
    runtime.unsubscribe();
    this.#runtimes.delete(runtime.id);
    this.#ids.delete(runtime.mounted);
    const mounts = this.#plugins.get(runtime.plugin);
    mounts?.delete(runtime.id);
    if (mounts?.size === 0) this.#plugins.delete(runtime.plugin);
    this.#emit();
  }

  #emit(): void {
    this.#observers.emit(this.snapshot);
  }
}

export function registry(context: Context): Registry {
  return runtimeRegistry(context);
}

function runtimeRegistry(context: Context): RuntimeRegistry {
  const identity = contextIdentity(context);
  let current = registries.get(identity);
  if (!current) {
    current = new RuntimeRegistry();
    registries.set(identity, current);
  }
  return current;
}

export function registerMount(
  context: Context,
  mounted: MountedPlugin,
  plugin: Plugin<any, any>,
): void {
  runtimeRegistry(context)[REGISTER](mounted, plugin);
}
