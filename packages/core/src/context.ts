import {
  Scope,
  ScopeClosedError,
  type Cleanup,
  type Dispose,
  type EffectSnapshot,
  type ScopeState,
} from "./scope.js";
import type { Token } from "./token.js";

interface ProviderEntry<T> {
  readonly id: number;
  readonly owner?: string;
  active: boolean;
  available: boolean;
  revision: number;
  value: T;
}

type ServiceInterceptor = (value: unknown) => unknown;

interface Node {
  readonly world: World;
  readonly parent?: Node;
  readonly providers: Map<Token<unknown>, ProviderEntry<unknown>>;
  readonly isolated: ReadonlySet<Token<unknown>>;
  readonly interceptors: ReadonlyMap<Token<unknown>, ServiceInterceptor>;
  attached: boolean;
}

class World {
  readonly listeners = new Map<Token<unknown>, Set<() => void>>();
  #nextProviderId = 1;

  nextProviderId(): number {
    const id = this.#nextProviderId;
    this.#nextProviderId += 1;
    return id;
  }

  changed(service: Token<unknown>): void {
    for (const listener of this.listeners.get(service) ?? []) listener();
  }

  observe(services: readonly Token<unknown>[], listener: () => void): Dispose {
    for (const service of services) {
      const listeners = this.listeners.get(service) ?? new Set();
      listeners.add(listener);
      this.listeners.set(service, listeners);
    }
    return async () => {
      for (const service of services) {
        const listeners = this.listeners.get(service);
        listeners?.delete(listener);
        if (listeners?.size === 0) this.listeners.delete(service);
      }
    };
  }
}

const CONTEXT_INTERNAL = Symbol("drydock.context.internal");

export interface ServiceProvider<T> {
  readonly id: number;
  readonly owner?: string;
  readonly token: Token<T>;
  readonly available: boolean;
  replace(value: T): void;
  suspend(): void;
  resume(): void;
  dispose(): Promise<void>;
}

export interface ServiceSnapshot {
  readonly id: number;
  readonly owner?: string;
  readonly token: Token<unknown>;
  readonly available: boolean;
  readonly revision: number;
}

export class ServiceMissingError extends Error {
  constructor(readonly token: Token<unknown>) {
    super(`service is unavailable: ${token.name}`);
    this.name = "ServiceMissingError";
  }
}

export class DuplicateServiceError extends Error {
  constructor(readonly token: Token<unknown>) {
    super(`service is already provided in this context: ${token.name}`);
    this.name = "DuplicateServiceError";
  }
}

export class Context {
  readonly #node: Node;
  readonly #scope: Scope;

  private constructor(
    node: Node,
    scope: Scope,
    private readonly owner?: string,
  ) {
    this.#node = node;
    this.#scope = scope;
  }

  get signal(): AbortSignal {
    return this.#scope.signal;
  }

  get state(): ScopeState {
    return this.#scope.state;
  }

  get effects(): readonly EffectSnapshot[] {
    return this.#scope.effects;
  }

  get services(): readonly ServiceSnapshot[] {
    return visibleServices(this.#node);
  }

  effect(cleanup: Cleanup, label?: string): Dispose {
    return this.#scope.own(cleanup, label);
  }

  child(): Context {
    return this.#child(new Set(), new Map());
  }

  isolate(...services: readonly Token<unknown>[]): Context {
    return this.#child(new Set(services), new Map());
  }

  intercept<T>(service: Token<T>, transform: (value: T) => T): Context {
    const intercept: ServiceInterceptor = (value) => transform(value as T);
    return this.#child(
      new Set(),
      new Map([[service as Token<unknown>, intercept]]),
    );
  }

  #child(
    isolated: ReadonlySet<Token<unknown>>,
    interceptors: ReadonlyMap<Token<unknown>, ServiceInterceptor>,
  ): Context {
    const scope = this.#scope.child();
    const node: Node = {
      world: this.#node.world,
      parent: this.#node,
      providers: new Map(),
      isolated,
      interceptors,
      attached: true,
    };
    scope.own(() => {
      node.attached = false;
    });
    return new Context(node, scope, this.owner);
  }

  provide<T>(service: Token<T>, value: T): ServiceProvider<T> {
    if (this.#node.providers.has(service as Token<unknown>)) {
      throw new DuplicateServiceError(service as Token<unknown>);
    }

    const entry: ProviderEntry<T> = {
      id: this.#node.world.nextProviderId(),
      ...(this.owner === undefined ? {} : { owner: this.owner }),
      active: true,
      available: true,
      revision: 0,
      value,
    };
    const assertActive = () => {
      if (!entry.active || this.#scope.state !== "open") throw new ScopeClosedError();
    };
    const dispose = this.#scope.own(() => {
      if (!entry.active) return;
      entry.active = false;
      entry.available = false;
      if (this.#node.providers.get(service as Token<unknown>) === entry) {
        this.#node.providers.delete(service as Token<unknown>);
        this.#node.world.changed(service as Token<unknown>);
      }
    });
    this.#node.providers.set(service as Token<unknown>, entry as ProviderEntry<unknown>);
    this.#node.world.changed(service as Token<unknown>);

    return {
      id: entry.id,
      ...(entry.owner === undefined ? {} : { owner: entry.owner }),
      token: service,
      get available() {
        return entry.active && entry.available;
      },
      replace: (next) => {
        assertActive();
        if (Object.is(entry.value, next)) return;
        entry.value = next;
        entry.revision += 1;
        this.#node.world.changed(service as Token<unknown>);
      },
      suspend: () => {
        assertActive();
        if (!entry.available) return;
        entry.available = false;
        this.#node.world.changed(service as Token<unknown>);
      },
      resume: () => {
        assertActive();
        if (entry.available) return;
        entry.available = true;
        this.#node.world.changed(service as Token<unknown>);
      },
      dispose,
    };
  }

  has(service: Token<unknown>): boolean {
    return resolve(this.#node, service) !== undefined;
  }

  use<T>(service: Token<T>): T {
    const resolved = resolve(this.#node, service);
    if (!resolved) throw new ServiceMissingError(service as Token<unknown>);
    let value = resolved.entry.value;
    for (const intercept of [...resolved.interceptors].reverse()) {
      value = intercept(value);
    }
    return value as T;
  }

  cancel(reason?: unknown): void {
    this.#scope.cancel(reason);
  }

  dispose(reason?: unknown): Promise<void> {
    return this.#scope.dispose(reason);
  }

  [CONTEXT_INTERNAL](): ContextInternals {
    return {
      identity: this.#node.world,
      bind: (scope, owner) => new Context(this.#node, scope, owner),
      observe: (services, listener) => this.#node.world.observe(services, listener),
      resolve: (services) => services.map((service): ServiceResolution => {
        const resolved = resolve(this.#node, service);
        return resolved
          ? { status: "available", provider: resolved.entry, revision: resolved.entry.revision }
          : { status: "missing" };
      }),
    };
  }

  static create(): Context {
    const world = new World();
    return new Context({
      world,
      providers: new Map(),
      isolated: new Set(),
      interceptors: new Map(),
      attached: true,
    }, new Scope());
  }
}

interface ResolvedService {
  readonly entry: ProviderEntry<unknown>;
  readonly interceptors: readonly ServiceInterceptor[];
}

function visibleServices(node: Node): ServiceSnapshot[] {
  const tokens = new Set<Token<unknown>>();
  for (let current: Node | undefined = node; current?.attached; current = current.parent) {
    for (const [service, entry] of current.providers) {
      if (entry.active) tokens.add(service);
    }
  }

  return [...tokens].flatMap((service) => {
    const entry = visibleProvider(node, service);
    return entry
      ? [{
        id: entry.id,
        ...(entry.owner === undefined ? {} : { owner: entry.owner }),
        token: service,
        available: entry.available,
        revision: entry.revision,
      }]
      : [];
  });
}

function visibleProvider(
  node: Node,
  service: Token<unknown>,
): ProviderEntry<unknown> | undefined {
  let suspended: ProviderEntry<unknown> | undefined;
  for (let current: Node | undefined = node; current?.attached; current = current.parent) {
    const entry = current.providers.get(service);
    if (entry?.active) {
      if (entry.available) return entry;
      suspended ??= entry;
    }
    if (current.isolated.has(service)) return suspended;
  }
  return suspended;
}

function resolve(node: Node, service: Token<unknown>): ResolvedService | undefined {
  const interceptors: ServiceInterceptor[] = [];
  for (let current: Node | undefined = node; current?.attached; current = current.parent) {
    const intercept = current.interceptors.get(service);
    if (intercept) interceptors.push(intercept);
    const entry = current.providers.get(service);
    if (entry?.active && entry.available) return { entry, interceptors };
    if (current.isolated.has(service)) return undefined;
  }
  return undefined;
}

export type ServiceResolution =
  | { readonly status: "missing" }
  | { readonly status: "available"; readonly provider: object; readonly revision: number };

interface ContextInternals {
  readonly identity: object;
  bind(scope: Scope, owner?: string): Context;
  observe(services: readonly Token<unknown>[], listener: () => void): Dispose;
  resolve(services: readonly Token<unknown>[]): ServiceResolution[];
}

export function contextIdentity(context: Context): object {
  return context[CONTEXT_INTERNAL]().identity;
}

export function bindContext(context: Context, scope: Scope, owner?: string): Context {
  return context[CONTEXT_INTERNAL]().bind(scope, owner);
}

export function observeServices(
  context: Context,
  services: readonly Token<unknown>[],
  listener: () => void,
): Dispose {
  return context[CONTEXT_INTERNAL]().observe(services, listener);
}

export function resolveServices(
  context: Context,
  required: readonly Token<unknown>[],
  optional: readonly Token<unknown>[] = [],
): { missing: Token<unknown>[]; services: ServiceResolution[] } {
  const internals = context[CONTEXT_INTERNAL]();
  const requiredServices = internals.resolve(required);
  return {
    missing: required.filter((_, index) => requiredServices[index]?.status === "missing"),
    services: [...requiredServices, ...internals.resolve(optional)],
  };
}
