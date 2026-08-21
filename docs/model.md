---
layout: default
title: Runtime model
description: The small set of primitives that shape runtime composition in Drydock.
---

Drydock has a small runtime model. Each primitive owns one part of composition, and ownership is visible in the runtime.

## Contexts

A context defines a service boundary. Child contexts inherit services by default and can isolate or transform selected services.

## Services

Services are values identified by typed tokens. A provider can be replaced, suspended, resumed, or disposed. Changes are visible to plugins that depend on the service.

## Scopes

A scope owns cleanup. Effects are released in reverse registration order, and child scopes close with their parent.

## Plugins

A plugin is a named unit of runtime behavior. It declares required and optional services, validates its configuration, and creates effects during setup.

Plugins use the same lifecycle whether they are defined directly or resolved dynamically.

## Loaders

The loader maps configuration entries to plugins through a host-provided resolver. It manages plugin generations, replacement, groups, and rollback without changing the core runtime.
