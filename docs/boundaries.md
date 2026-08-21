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
- Reusable filesystem watching and HMR coordination.

## The host owns

- Package installation, configuration, and permissions.
- Module installation, resolution policy, and dynamic loading permissions.
- HMR roots, source mapping, and filesystem permissions.

Dynamic loading is optional. Hosts provide a resolver when they need it. The Bun adapter is one resolver implementation for JavaScript and TypeScript modules. The HMR package coordinates changes, but the host still chooses what is watched and which source graph is trusted.
