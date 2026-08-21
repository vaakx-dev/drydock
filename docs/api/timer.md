---
layout: default
title: Timer API
description: Context-owned timeouts, intervals, sleeps, and cancellation.
permalink: /api/timer/
---

Package: `@drydock/timer`

All timer operations register cleanup against the supplied context. Disposing or cancelling the context stops active timers.

## Functions

```ts
function timeout(
  context: Context,
  callback: () => void,
  delay: number,
): Dispose

function interval(
  context: Context,
  callback: () => void,
  delay: number,
): Dispose

function sleep(context: Context, delay: number): Promise<void>
```

`timeout()` runs once and then releases its effect. `interval()` runs until its returned disposer or the context closes. `sleep()` resolves after the delay and rejects with `TimerCancelledError` when the context is cancelled first.

## TimerCancelledError

```ts
class TimerCancelledError extends Error {
  readonly reason: unknown
  constructor(reason: unknown)
}
```

Delays must be finite numbers from `0` through `2_147_483_647` milliseconds. Invalid delays throw `RangeError` before a timer is allocated.
