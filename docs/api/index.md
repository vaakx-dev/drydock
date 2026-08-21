---
layout: default
title: API reference
description: The public TypeScript API for every Drydock package.
permalink: /api/
---

This reference covers the exports available from each package root. Internal modules are not part of the public API.

## Packages

- [`@drydock/core`](core/): contexts, scopes, plugins, tokens, configuration, and registries.
- [`@drydock/events`](events/): typed event names, listeners, dispatch, and filters.
- [`@drydock/loader`](loader/): declarative plugin configuration and generation management.
- [`@drydock/bun`](bun/): a Bun-backed plugin resolver with explicit invalidation.
- [`@drydock/logger`](logger/): log levels, records, sinks, and child fields.
- [`@drydock/timer`](timer/): context-owned timer operations.

## Reading the reference

Signatures use TypeScript notation. `readonly` describes the public shape. A method that returns `Dispose` returns an async function that releases the resource it created.
