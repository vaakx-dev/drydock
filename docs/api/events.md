---
layout: default
title: Events API
description: Typed event dispatch with context-owned listeners.
permalink: /api/events/
---

Package: `@drydock/events`

## Types

The event schema is an object whose function-valued properties define the event names and listener signatures.

```ts
type EventName<Schema extends object> = {
  [Name in keyof Schema]: Schema[Name] extends (...args: any[]) => unknown ? Name : never
}[keyof Schema] & PropertyKey

type EventListener<Schema extends object, Name extends EventName<Schema>> =
  Extract<Schema[Name], (...args: any[]) => unknown>

interface EventOptions {
  readonly prepend?: boolean
  readonly filter?: (source: Context | undefined) => boolean
}
```

## Events

Listeners are owned by the context passed to `on()` or `once()`. Disposing that context removes its listeners.

```ts
class Events<Schema extends object> {
  on<Name extends EventName<Schema>>(
    context: Context,
    name: Name,
    listener: EventListener<Schema, Name>,
    options?: EventOptions,
  ): Dispose

  once<Name extends EventName<Schema>>(
    context: Context,
    name: Name,
    listener: EventListener<Schema, Name>,
    options?: EventOptions,
  ): Dispose

  emit<Name extends EventName<Schema>>(
    name: Name,
    ...args: Parameters<EventListener<Schema, Name>>,
  ): void

  emit<Name extends EventName<Schema>>(
    source: Context,
    name: Name,
    ...args: Parameters<EventListener<Schema, Name>>,
  ): void

  parallel<Name extends EventName<Schema>>(
    name: Name,
    ...args: Parameters<EventListener<Schema, Name>>,
  ): Promise<void>

  bail<Name extends EventName<Schema>>(
    name: Name,
    ...args: Parameters<EventListener<Schema, Name>>,
  ): ReturnType<EventListener<Schema, Name>> | undefined

  serial<Name extends EventName<Schema>>(
    name: Name,
    ...args: Parameters<EventListener<Schema, Name>>,
  ): Promise<Awaited<ReturnType<EventListener<Schema, Name>>> | undefined>

  waterfall<Name extends EventName<Schema>>(
    name: Name,
    ...args: unknown[],
  ): ReturnType<EventListener<Schema, Name>>

  listenerCount<Name extends EventName<Schema>>(name: Name): number
}
```

`emit()` dispatches synchronously to every matching listener. `parallel()` waits for all listeners and aggregates failures. `bail()` returns the first meaningful synchronous result. `serial()` awaits listeners and stops at the first meaningful result. `waterfall()` composes middleware around a fallback.

The source-context overloads for `emit()`, `parallel()`, `bail()`, and `serial()` enable `EventOptions.filter` to select listeners.
