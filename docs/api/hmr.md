---
layout: default
title: "@drydock/hmr"
description: File watching and lifecycle-aware plugin reloads.
permalink: /api/hmr/
---

`@drydock/hmr` connects filesystem changes to a [`Loader`](loader/). It watches one or more roots, maps each loaded entry to its source files, debounces changes, and calls `loader.reload(id)` for affected entries.

The loader must expose reload support. `watch()` throws `ReloadUnsupportedError` immediately when its resolver cannot invalidate modules.

## `watch(loader, options)`

```ts
function watch(loader: Loader, options: HmrOptions): HmrWatcher;
```

```ts
type HmrFailurePhase = "watch" | "sources" | "reload"

interface HmrFailure {
  readonly phase: HmrFailurePhase
  readonly error: unknown
  readonly entries: readonly string[]
  readonly files: readonly string[]
}
```

With `@drydock/bun`, the resolver supplies the source graph captured by its last bundle:

```ts
const watcher = watch(loader, {
  roots: ["./src"],
  sources: (entry) => resolver.dependencies(entry.use),
});
```

`HmrOptions` requires:

- `roots`: directories to watch recursively.
- `sources`: returns the current source files for each `PluginEntry`.

Optional settings include `debounceMs`, `extensions`, `ignore`, and `onError`. When a changed file inside a watched root is not in the current source index, all active entries are reloaded so newly added imports are detected.

The returned watcher exposes `state`, `refresh()`, and async `close()`. `onError` receives a phase of `watch`, `sources`, or `reload`; failures do not stop future file changes from being processed.
