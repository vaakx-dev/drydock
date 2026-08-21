# @drydock/hmr

File watching and lifecycle-aware plugin reloads for Drydock.

The watcher observes source files, maps changes to configured loader entries, and calls `Loader.reload()`. The loader remains responsible for invalidation, disposal, activation, dependency recomposition, and rollback.
