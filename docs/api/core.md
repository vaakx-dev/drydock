---
layout: default
title: Core API
description: Contexts, scopes, services, plugins, tokens, configuration, and registries.
permalink: /api/core/
---

Package: `@drydock/core`

## Scope

`Scope` owns cleanup and cancellation. Child scopes are disposed with their parent. Effects are released in reverse registration order.

```ts
type Cleanup = () => void | Promise<void>
type Dispose = () => Promise<void>
type ScopeState = "open" | "closing" | "closed"

interface EffectSnapshot {
  readonly label: string
  readonly children: readonly EffectSnapshot[]
}

class Scope {
  constructor(parent?: Scope, label?: string)
  readonly signal: AbortSignal
  readonly state: ScopeState
  readonly effects: readonly EffectSnapshot[]
  own(cleanup: Cleanup, label?: string): Dispose
  child(label?: string): Scope
  cancel(reason?: unknown): void
  dispose(reason?: unknown): Promise<void>
}
```

`ScopeClosedError` is thrown when an effect is added to a closed scope.

## Context

`Context` combines a service boundary with a scope. `Context.create()` creates a root context. Child contexts inherit visible services unless they isolate or intercept them.

```ts
interface ServiceProvider<T> {
  readonly token: Token<T>
  readonly id: number
  readonly owner?: string
  readonly available: boolean
  replace(value: T): void
  suspend(): void
  resume(): void
  dispose(): Promise<void>
}

class Context {
  readonly signal: AbortSignal
  readonly state: ScopeState
  readonly effects: readonly EffectSnapshot[]
  readonly services: readonly ServiceSnapshot[]
  static create(): Context
  child(): Context
  isolate(...services: readonly Token<unknown>[]): Context
  intercept<T>(service: Token<T>, transform: (value: T) => T): Context
  provide<T>(service: Token<T>, value: T): ServiceProvider<T>
  has(service: Token<unknown>): boolean
  use<T>(service: Token<T>): T
  effect(cleanup: Cleanup, label?: string): Dispose
  cancel(reason?: unknown): void
  dispose(reason?: unknown): Promise<void>
}
```

`services` is an inspection-safe view of the providers visible from the context. It includes provider identity, optional plugin owner, token, availability, and revision, but never exposes service values.

```ts
interface ServiceSnapshot {
  readonly id: number
  readonly owner?: string
  readonly token: Token<unknown>
  readonly available: boolean
  readonly revision: number
}
```

`ServiceMissingError` is thrown by `use()` when a token is unavailable. `DuplicateServiceError` is thrown when a context already provides the token.

## Tokens

Tokens identify typed services. Two tokens with the same name are still distinct.

```ts
interface Token<T> {
  readonly id: symbol
  readonly name: string
}

function token<T>(name: string): Token<T>
```

## Plugins

`Plugin` is the definition. `mount()` creates a managed instance in a context. `definePlugin()` validates and freezes a definition. `isPlugin()` is the structural guard for values that cross the host or loader boundary.

```ts
function isPlugin(value: unknown): value is Plugin<unknown>
```

```ts
interface Plugin<Config = undefined, Input = Config> {
  readonly name: string
  readonly requires?: readonly Token<unknown>[]
  readonly optional?: readonly Token<unknown>[]
  readonly schema?: ConfigSchema<Input, Config>
  setup(context: Context, config: Config): Cleanup | void | Promise<Cleanup | void>
}

function definePlugin<Config, Input = Config>(
  plugin: Plugin<Config, Input>,
): Plugin<Config, Input>

function mount<Config, Input = Config>(
  context: Context,
  plugin: Plugin<Config, Input>,
  ...args: undefined extends Input ? [config?: Input] : [config: Input],
): MountedPlugin<Input>
```

`MountedPlugin` exposes `state`, owned `effects`, `restart()`, `update()`, `settled()`, and `dispose()`. Its state is one of `waiting`, `starting`, `active`, `stopping`, `failed`, or `disposed`.

```ts
interface MountedPlugin<Input = unknown> {
  readonly name: string
  readonly state: MountState
  readonly effects: readonly EffectSnapshot[]
  subscribe(listener: (state: MountState) => void, onError?: (error: unknown) => void): () => void
  settled(): Promise<void>
  restart(): void
  update(config: Input): Promise<void>
  dispose(reason?: unknown): Promise<void>
}
```

`inspect(context)` combines the context's visible services with the shared registry's mounted-plugin snapshot.

```ts
interface RuntimeSnapshot {
  readonly services: readonly ServiceSnapshot[]
  readonly plugins: readonly RegisteredPlugin[]
}

function inspect(context: Context): RuntimeSnapshot
```

```ts
type MountState =
  | { readonly status: "waiting"; readonly missing: readonly Token<unknown>[] }
  | { readonly status: "starting" }
  | { readonly status: "active" }
  | { readonly status: "stopping" }
  | { readonly status: "failed"; readonly error: unknown }
  | { readonly status: "disposed" }
```

## Configuration

`ConfigSchema` follows the Standard Schema validation shape. `validateConfig()` returns the validated output or rejects with `ConfigValidationError`.

```ts
type ConfigPathSegment = PropertyKey | { readonly key: PropertyKey }

interface ConfigIssue {
  readonly message: string
  readonly path?: readonly ConfigPathSegment[]
}

type ConfigResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly ConfigIssue[] }

interface ConfigSchema<Input, Output = Input> {
  readonly "~standard": {
    readonly validate: (
      value: unknown,
    ) => ConfigResult<Output> | Promise<ConfigResult<Output>>
  }
}

function validateConfig<Input, Output>(
  schema: ConfigSchema<Input, Output> | undefined,
  input: Input,
): Promise<Output>
```

## Registry

`registry(context)` returns the registry shared by the context tree. It tracks mounted plugins, their state, and their effect snapshots.

```ts
interface Registry {
  readonly size: number
  readonly snapshot: RegistrySnapshot
  get(id: number): MountedPlugin | undefined
  id(mounted: MountedPlugin): number | undefined
  mounts<Config, Input>(plugin: Plugin<Config, Input>): readonly MountedPlugin[]
  restart(id: number): boolean
  restartAll<Config, Input>(plugin: Plugin<Config, Input>): number
  dispose(id: number, reason?: unknown): Promise<boolean>
  disposeAll<Config, Input>(plugin: Plugin<Config, Input>, reason?: unknown): Promise<number>
  subscribe(listener: (snapshot: RegistrySnapshot) => void, onError?: (error: unknown) => void): () => void
}

function registry(context: Context): Registry
```

```ts
interface RegisteredPlugin {
  readonly id: number
  readonly name: string
  readonly requires: readonly Token<unknown>[]
  readonly optional: readonly Token<unknown>[]
  readonly state: MountState
  readonly effects: readonly EffectSnapshot[]
}

interface RegistrySnapshot {
  readonly plugins: readonly RegisteredPlugin[]
}
```
