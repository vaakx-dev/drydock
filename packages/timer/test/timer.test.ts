import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@drydock/core";
import { TimerCancelledError, interval, sleep, timeout } from "../src/index.js";

test("a timeout is released after it runs", async () => {
  const context = Context.create();
  let calls = 0;

  timeout(context, () => {
    calls += 1;
  }, 5);
  await wait(20);

  assert.equal(calls, 1);
  await context.dispose();
});

test("disposing a context cancels its timers", async () => {
  const context = Context.create();
  let calls = 0;

  timeout(context, () => {
    calls += 1;
  }, 20);
  await context.dispose("host stopped");
  await wait(30);

  assert.equal(calls, 0);
});

test("an interval stops with its context", async () => {
  const context = Context.create();
  let calls = 0;

  interval(context, () => {
    calls += 1;
  }, 5);
  await wait(20);
  await context.dispose();
  const stoppedAt = calls;
  await wait(20);

  assert.ok(stoppedAt > 0);
  assert.equal(calls, stoppedAt);
});

test("sleep resolves normally and rejects when its context closes", async () => {
  const active = Context.create();
  await sleep(active, 5);
  await active.dispose();

  const cancelled = Context.create();
  const pending = sleep(cancelled, 30);
  await cancelled.dispose("shutdown");
  await assert.rejects(pending, (error: unknown) => (
    error instanceof TimerCancelledError && error.reason === "shutdown"
  ));
});

test("invalid delays are rejected before allocating a timer", async () => {
  const context = Context.create();

  assert.throws(() => timeout(context, () => undefined, -1), RangeError);
  assert.throws(() => interval(context, () => undefined, Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => sleep(context, Number.NaN), RangeError);
  await context.dispose();
});

function wait(delay: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delay));
}
