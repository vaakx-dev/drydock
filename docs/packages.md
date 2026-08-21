---
layout: default
title: Packages
description: Six focused packages, one shared runtime model.
---

| Package | Role |
| --- | --- |
| `@drydock/core` | Scoped contexts, services, effects, and plugins |
| `@drydock/events` | Typed, lifecycle-owned events |
| `@drydock/loader` | Declarative plugin loading and replacement |
| `@drydock/bun` | Bun module resolution and plugin reloads |
| `@drydock/logger` | Structured contextual logging |
| `@drydock/timer` | Lifecycle-owned timers |

`@drydock/core` is the base package. Events, loader, logger, and timer build on it. The Bun adapter builds on the loader.

## API reference

- [`@drydock/core`](api/core/): contexts, scopes, plugins, tokens, and registries.
- [`@drydock/events`](api/events/): typed event dispatch and lifecycle-owned listeners.
- [`@drydock/loader`](api/loader/): plugin entries, resolvers, loading, and replacement.
- [`@drydock/bun`](api/bun/): Bun resolution and explicit module invalidation.
- [`@drydock/logger`](api/logger/): structured records, sinks, and contextual loggers.
- [`@drydock/timer`](api/timer/): timeouts, intervals, sleeps, and cancellation.
