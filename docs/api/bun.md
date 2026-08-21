---
layout: default
title: Bun API
description: Bun-backed module resolution for Drydock plugins.
permalink: /api/bun/
---

Package: `@drydock/bun`

## BunResolverOptions

```ts
interface BunResolverOptions {
  readonly external?: readonly string[]
  readonly from?: string | URL
}
```

`external` adds package or path patterns to Bun's external dependency list. `from` sets the module-resolution origin and defaults to the current working directory's `package.json`.

## BunResolver

`BunResolver` is both a callable `PluginResolver` and an object with explicit invalidation.

```ts
interface BunResolver {
  (specifier: string): Promise<Plugin<unknown>>
  invalidate(specifier: string): void
  dependencies(specifier: string): readonly string[]
}
```

## bunResolver()

```ts
function bunResolver(options?: BunResolverOptions): BunResolver
```

The resolver bundles plugin-local imports with `Bun.build()`, keeps package imports external, and caches each resolved module until `invalidate()` is called. Each bundle is evaluated through a fresh CommonJS factory, so local plugin module state is not retained in a growing `data:` module cache. External packages still use the host resolver and their normal package cache. `dependencies()` returns the absolute source files captured by the last successful bundle. Hosts can use that graph to watch source files and reload affected plugins.
