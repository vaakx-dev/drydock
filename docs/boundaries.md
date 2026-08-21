---
layout: default
title: Boundaries
description: The runtime stays focused on composition and ownership.
---

Drydock owns runtime composition. The host owns its environment.

## The runtime owns

- Contexts, services, plugins, and their lifetimes.
- Effects, cleanup, activation, and recomposition.
- Loader generations, explicit reloads, and rollback.

## The host owns

- Package installation, configuration, and permissions.
- Module resolution and dynamic loading policy.
- File watching and hot module replacement.

Dynamic loading is optional. Hosts provide a resolver when they need it. The Bun adapter is one resolver implementation for JavaScript and TypeScript modules.
