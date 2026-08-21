---
layout: default
title: Loader API
description: Declarative plugin configuration and generation management.
permalink: /api/loader/
---

Package: `@drydock/loader`

## Configuration types

```ts
interface PluginEntry {
  readonly id: string
  readonly use: string
  readonly config?: unknown
  readonly disabled?: boolean
  readonly group?: string
}

interface PluginGroup {
  readonly id: string
  readonly entries: readonly LoaderConfig[]
  readonly disabled?: boolean
}

type LoaderConfig = PluginEntry | PluginGroup

interface LoadedEntry {
  readonly id: string
  readonly use: string
  readonly state: MountState
}

interface LoaderSnapshot {
  readonly entries: readonly LoadedEntry[]
}
```

`PluginEntry.id` identifies a configured instance. `PluginEntry.use` is passed to the resolver. Groups create stable slash-separated ids for nested entries.

## Resolver

The host supplies resolution. A resolver may expose `invalidate()` when it can clear its own module cache.

```ts
interface PluginResolver {
  (specifier: string): Plugin<unknown> | Promise<Plugin<unknown>>
  readonly invalidate?: (specifier: string) => void | Promise<void>
}

interface ReloadablePluginResolver extends PluginResolver {
  readonly invalidate: (specifier: string) => void | Promise<void>
}

function isReloadablePluginResolver(
  resolver: PluginResolver,
): resolver is ReloadablePluginResolver
```

## Loader

```ts
class Loader {
  constructor(context: Context, resolve: PluginResolver)
  readonly state: LoaderState
  readonly entries: readonly PluginEntry[]
  readonly supportsReload: boolean
  subscribe(listener: (state: LoaderState) => void, onError?: (error: unknown) => void): () => void
  load(config: readonly LoaderConfig[]): Promise<LoaderSnapshot>
  set(entry: PluginEntry): Promise<LoaderSnapshot>
  setGroup(group: PluginGroup): Promise<LoaderSnapshot>
  removeGroup(id: string, reason?: unknown): Promise<number>
  reload(id?: string): Promise<LoaderSnapshot>
  unload(id: string, reason?: unknown): Promise<boolean>
  close(reason?: unknown): Promise<void>
}
```

`load()` replaces the configured generation. `set()` changes one entry. `setGroup()` replaces the entries in one group. `reload()` invalidates supported resolvers before replacement. `unload()` removes one entry. `close()` disposes the loader and its active generation.

`ReloadUnsupportedError` is thrown when `reload()` is requested from a resolver without `invalidate()`.

Activation failures leave the previous generation in place when rollback succeeds. Loader operations are serialized, and state subscriptions are observational.

## LoaderState

```ts
type LoaderState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "active"; readonly snapshot: LoaderSnapshot }
  | { readonly status: "failed"; readonly error: unknown; readonly snapshot: LoaderSnapshot }
  | { readonly status: "closed" }
```
