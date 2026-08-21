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
}
```

## bunResolver()

```ts
function bunResolver(options?: BunResolverOptions): BunResolver
```

The resolver bundles plugin-local imports with `Bun.build()`, keeps package imports external, and caches each resolved module until `invalidate()` is called.
