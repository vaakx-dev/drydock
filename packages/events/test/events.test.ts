import assert from "node:assert/strict";
import test from "node:test";

import { Context, token } from "@drydock/core";

import { Events } from "../src/index.js";

interface AppEvents {
  readonly message: (value: string) => void;
  readonly work: (value: number) => void | Promise<void>;
  readonly choose: (value: string) => string | undefined;
  readonly chooseAsync: (value: string) => string | undefined | Promise<string | undefined>;
  readonly transform: (value: string, next: () => string) => string;
}

test("listeners follow context lifetime and deterministic order", async () => {
  const root = Context.create();
  const child = root.child();
  const events = new Events<AppEvents>();
  const values: string[] = [];
  events.on(root, "message", (value) => values.push(`root:${value}`));
  events.on(child, "message", (value) => values.push(`child:${value}`), { prepend: true });

  assert.deepEqual(events.snapshot, [{ name: "message", listenerCount: 2 }]);

  events.emit("message", "first");
  await child.dispose();
  events.emit("message", "second");

  assert.deepEqual(values, ["child:first", "root:first", "root:second"]);
  assert.equal(events.listenerCount("message"), 1);
  assert.deepEqual(events.snapshot, [{ name: "message", listenerCount: 1 }]);
  await root.dispose();
  assert.equal(events.listenerCount("message"), 0);
  assert.deepEqual(events.snapshot, []);
});

test("one-shot listeners remove themselves before dispatch", async () => {
  const context = Context.create();
  const events = new Events<AppEvents>();
  let calls = 0;
  events.once(context, "message", () => {
    calls += 1;
  });

  events.emit("message", "first");
  events.emit("message", "second");

  assert.equal(calls, 1);
  assert.equal(events.listenerCount("message"), 0);
  await context.dispose();
});

test("parallel dispatch waits for every listener before reporting failures", async () => {
  const context = Context.create();
  const events = new Events<AppEvents>();
  const values: number[] = [];
  events.on(context, "work", async (value) => {
    await Promise.resolve();
    values.push(value);
  });
  events.on(context, "work", () => {
    throw new Error("work failed");
  });

  await assert.rejects(events.parallel("work", 2), AggregateError);

  assert.deepEqual(values, [2]);
  await context.dispose();
});

test("bail and serial dispatch stop at the first meaningful result", async () => {
  const context = Context.create();
  const events = new Events<AppEvents>();
  const calls: string[] = [];
  events.on(context, "choose", () => undefined);
  events.on(context, "choose", (value) => {
    calls.push("sync");
    return value;
  });
  events.on(context, "choose", () => {
    calls.push("unreachable-sync");
    return "late";
  });
  events.on(context, "chooseAsync", async () => undefined);
  events.on(context, "chooseAsync", async (value) => {
    calls.push("async");
    return value;
  });
  events.on(context, "chooseAsync", () => {
    calls.push("unreachable-async");
    return "late";
  });

  assert.equal(events.bail("choose", "selected"), "selected");
  assert.equal(await events.serial("chooseAsync", "selected-async"), "selected-async");
  assert.deepEqual(calls, ["sync", "async"]);
  await context.dispose();
});

test("listeners can filter dispatch by source context", async () => {
  const root = Context.create();
  const tenant = token<string>("tenant");
  const blue = root.child();
  const red = root.child();
  blue.provide(tenant, "blue");
  red.provide(tenant, "red");
  const events = new Events<AppEvents>();
  const values: string[] = [];
  events.on(root, "message", (value) => values.push(`all:${value}`));
  events.on(root, "message", (value) => values.push(`blue:${value}`), {
    filter: (source) => source?.has(tenant) === true && source.use(tenant) === "blue",
  });

  events.emit(blue, "message", "first");
  events.emit(red, "message", "second");
  events.emit("message", "global");

  assert.deepEqual(values, [
    "all:first",
    "blue:first",
    "all:second",
    "all:global",
  ]);
  await root.dispose();
});

test("waterfall dispatch composes lifecycle-owned middleware", async () => {
  const context = Context.create();
  const events = new Events<AppEvents>();
  events.on(context, "transform", (_value, next) => `outer(${next()})`);
  events.on(context, "transform", (_value, next) => `inner(${next()})`);

  const result = events.waterfall("transform", "value", (value) => value);

  assert.equal(result, "outer(inner(value))");
  await context.dispose();
});
