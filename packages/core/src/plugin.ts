import {
  bindContext,
  observeServices,
  resolveServices,
  type Context,
  type ServiceResolution,
} from "./context.js";
import { validateConfig, type ConfigSchema } from "./config.js";
import {
  Scope,
  ScopeClosedError,
  type Cleanup,
  type Dispose,
  type EffectSnapshot,
} from "./scope.js";
import type { Token } from "./token.js";
import { registerMount } from "./registry.js";
import { Observers } from "./observers.js";

export interface Plugin<Config = undefined, Input = Config> {
  readonly name: string;
  readonly requires?: readonly Token<unknown>[];
  readonly optional?: readonly Token<unknown>[];
  readonly schema?: ConfigSchema<Input, Config>;
  setup(context: Context, config: Config): Cleanup | void | Promise<Cleanup | void>;
}

export type MountState =
  | { readonly status: "waiting"; readonly missing: readonly Token<unknown>[] }
  | { readonly status: "starting" }
  | { readonly status: "active" }
  | { readonly status: "stopping" }
  | { readonly status: "failed"; readonly error: unknown }
  | { readonly status: "disposed" };

export interface MountedPlugin<Input = unknown> {
  readonly name: string;
  readonly state: MountState;
  readonly effects: readonly EffectSnapshot[];
  subscribe(
    listener: (state: MountState) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  settled(): Promise<void>;
  restart(): void;
  update(config: Input): Promise<void>;
  dispose(reason?: unknown): Promise<void>;
}

interface Activation {
  readonly scope: Scope;
  readonly services: readonly ServiceResolution[];
}

const definitions = new WeakMap<object, Plugin<any, any>>();

export function definePlugin<Config, Input = Config>(
  plugin: Plugin<Config, Input>,
): Plugin<Config, Input> {
  const existing = definitions.get(plugin);
  if (existing) return existing as Plugin<Config, Input>;
  if (!plugin.name.trim()) throw new Error("plugin name is required");
  const requirements = plugin.requires ?? [];
  const optional = plugin.optional ?? [];
  const dependencies = [...requirements, ...optional];
  if (new Set(dependencies).size !== dependencies.length) {
    throw new Error(`plugin has duplicate service dependencies: ${plugin.name}`);
  }
  const definition = Object.freeze({
    ...plugin,
    name: plugin.name.trim(),
    requires: Object.freeze([...requirements]),
    optional: Object.freeze([...optional]),
  });
  definitions.set(plugin, definition);
  definitions.set(definition, definition);
  return definition;
}

export function mount<Config, Input = Config>(
  context: Context,
  plugin: Plugin<Config, Input>,
  ...args: undefined extends Input ? [config?: Input] : [config: Input]
): MountedPlugin<Input> {
  const [config] = args;
  const definition = definePlugin(plugin);
  const mounted = new PluginMount(context, definition, config as Input);
  registerMount(context, mounted, definition);
  return mounted;
}

class PluginMount<Config, Input> implements MountedPlugin<Input> {
  readonly #lifetime = new Scope();
  readonly #observers = new Observers<MountState>();
  readonly #requirements: readonly Token<unknown>[];
  readonly #optional: readonly Token<unknown>[];
  readonly #contextDispose: Dispose;
  #state: MountState;
  #active: Activation | undefined;
  #attempt: Activation | undefined;
  #failedServices: readonly ServiceResolution[] | undefined;
  #dirty = false;
  #restart = false;
  #disposed = false;
  #running: Promise<void> | undefined;
  #disposal: Promise<void> | undefined;
  #updates = Promise.resolve();
  #disposalErrors: unknown[] = [];
  #disposeReason: unknown;
  #config: Promise<Config>;
  #configRevision = 0;

  constructor(
    private readonly context: Context,
    private readonly plugin: Plugin<Config, Input>,
    config: Input,
  ) {
    this.#config = validateConfig(plugin.schema, config);
    this.#requirements = plugin.requires ?? [];
    this.#optional = plugin.optional ?? [];
    this.#state = { status: "waiting", missing: [...this.#requirements] };
    this.#lifetime.own(observeServices(
      context,
      [...this.#requirements, ...this.#optional],
      () => this.#servicesChanged(),
    ));
    this.#contextDispose = context.effect(() => (
      this.#beginDisposal(this.#disposeReason ?? context.signal.reason)
    ), plugin.name);
    this.#schedule();
  }

  get name(): string {
    return this.plugin.name;
  }

  get state(): MountState {
    return this.#state;
  }

  get effects(): readonly EffectSnapshot[] {
    return (this.#attempt ?? this.#active)?.scope.effects ?? [];
  }

  subscribe(
    listener: (state: MountState) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    return this.#observers.subscribe(listener, onError);
  }

  async settled(): Promise<void> {
    while (this.#running) await this.#running;
  }

  restart(): void {
    if (this.#disposed) return;
    this.#restart = true;
    this.#failedServices = undefined;
    this.#active?.scope.cancel(new Error(`plugin restart requested: ${this.name}`));
    this.#attempt?.scope.cancel(new Error(`plugin restart requested: ${this.name}`));
    this.#schedule();
  }

  update(config: Input): Promise<void> {
    const update = this.#updates.then(async () => {
      if (this.#disposed) throw new ScopeClosedError();
      const validated = await validateConfig(this.plugin.schema, config);
      if (this.#disposed) throw new ScopeClosedError();
      const previous = this.#config;
      this.#config = Promise.resolve(validated);
      this.#configRevision += 1;
      this.restart();
      await this.settled();
      if (this.#state.status !== "failed") return;
      const failure = this.#state.error;
      this.#config = previous;
      this.#configRevision += 1;
      this.restart();
      await this.settled();
      if (this.#state.status === "failed") {
        throw new AggregateError(
          [failure, this.#state.error],
          `plugin configuration update and rollback failed: ${this.name}`,
        );
      }
      throw failure;
    });
    this.#updates = update.then(() => undefined, () => undefined);
    return update;
  }

  dispose(reason?: unknown): Promise<void> {
    if (this.#disposal) return this.#disposal;
    this.#disposeReason = reason;
    return this.#contextDispose();
  }

  #beginDisposal(reason?: unknown): Promise<void> {
    if (this.#disposal) return this.#disposal;
    this.#disposed = true;
    this.#active?.scope.cancel(reason);
    this.#attempt?.scope.cancel(reason);
    this.#schedule();
    this.#disposal = this.#finishDisposal(reason);
    return this.#disposal;
  }

  async #finishDisposal(reason?: unknown): Promise<void> {
    await this.settled();
    try {
      await this.#lifetime.dispose(reason);
    } catch (error) {
      this.#disposalErrors.push(error);
    }
    this.#setState({ status: "disposed" });
    if (this.#disposalErrors.length > 0) {
      throw new AggregateError(this.#disposalErrors, `plugin cleanup failed: ${this.name}`);
    }
  }

  #servicesChanged(): void {
    const activation = this.#attempt ?? this.#active;
    if (activation) {
      const current = resolveServices(this.context, this.#requirements, this.#optional);
      if (current.missing.length > 0 || !sameServices(current.services, activation.services)) {
        activation.scope.cancel(new Error(`plugin dependencies changed: ${this.name}`));
      }
    }
    this.#schedule();
  }

  #schedule(): void {
    this.#dirty = true;
    if (this.#running) return;
    const running = Promise.resolve()
      .then(() => this.#drain())
      .finally(() => {
        if (this.#running === running) this.#running = undefined;
        if (this.#dirty) this.#schedule();
      });
    this.#running = running;
  }

  async #drain(): Promise<void> {
    while (this.#dirty) {
      this.#dirty = false;
      await this.#reconcile();
    }
  }

  async #reconcile(): Promise<void> {
    if (this.#disposed) {
      await this.#stop();
      return;
    }

    let current = resolveServices(this.context, this.#requirements, this.#optional);
    if (current.missing.length > 0) {
      if (!await this.#stop()) return;
      this.#failedServices = undefined;
      this.#setState({ status: "waiting", missing: current.missing });
      return;
    }

    if (this.#active) {
      if (!this.#restart && sameServices(current.services, this.#active.services)) return;
      if (!await this.#stop()) return;
      this.#restart = false;
      current = resolveServices(this.context, this.#requirements, this.#optional);
      if (current.missing.length > 0) {
        this.#setState({ status: "waiting", missing: current.missing });
        return;
      }
    }

    if (this.#restart) this.#restart = false;

    if (this.#failedServices && sameServices(current.services, this.#failedServices)) return;
    await this.#start(current.services);
  }

  async #start(services: readonly ServiceResolution[]): Promise<void> {
    const scope = this.#lifetime.child();
    const activation = { scope, services };
    const configRevision = this.#configRevision;
    this.#attempt = activation;
    this.#setState({ status: "starting" });
    try {
      const config = await this.#config;
      if (configRevision !== this.#configRevision) {
        this.#attempt = undefined;
        await this.#disposeActivation(scope);
        this.#dirty = true;
        return;
      }
      const cleanup = await this.plugin.setup(
        bindContext(this.context, scope, this.plugin.name),
        config,
      );
      if (cleanup) scope.own(cleanup);
      const current = resolveServices(this.context, this.#requirements, this.#optional);
      if (
        this.#disposed
        || this.#restart
        || configRevision !== this.#configRevision
        || current.missing.length > 0
        || !sameServices(current.services, services)
      ) {
        this.#attempt = undefined;
        scope.cancel(new Error(`plugin activation became stale: ${this.name}`));
        await this.#disposeActivation(scope);
        this.#dirty = true;
        return;
      }
      this.#attempt = undefined;
      this.#active = activation;
      this.#failedServices = undefined;
      this.#setState({ status: "active" });
    } catch (error) {
      this.#attempt = undefined;
      const failure = await this.#disposeActivation(scope, error);
      this.#failedServices = services;
      this.#setState({ status: "failed", error: failure });
    }
  }

  async #stop(): Promise<boolean> {
    const activation = this.#attempt ?? this.#active;
    if (!activation) return true;
    this.#attempt = undefined;
    this.#active = undefined;
    this.#setState({ status: "stopping" });
    const error = await this.#disposeActivation(activation.scope);
    if (error === undefined) return true;
    if (this.#disposed) {
      this.#disposalErrors.push(error);
    } else {
      this.#failedServices = resolveServices(
        this.context,
        this.#requirements,
        this.#optional,
      ).services;
      this.#setState({ status: "failed", error });
    }
    return false;
  }

  async #disposeActivation(scope: Scope, cause?: unknown): Promise<unknown | undefined> {
    try {
      await scope.dispose(cause);
      return cause;
    } catch (cleanupError) {
      return cause === undefined
        ? cleanupError
        : new AggregateError([cause, cleanupError], `plugin activation failed: ${this.name}`);
    }
  }

  #setState(state: MountState): void {
    this.#state = state;
    this.#observers.emit(state);
  }
}

function sameServices(
  left: readonly ServiceResolution[],
  right: readonly ServiceResolution[],
): boolean {
  return left.length === right.length && left.every((service, index) => {
    const other = right[index];
    if (!other || service.status !== other.status) return false;
    return service.status === "missing"
      || (
        other.status === "available"
        && service.provider === other.provider
        && service.revision === other.revision
      );
  });
}
