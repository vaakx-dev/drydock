import assert from "node:assert/strict";
import test from "node:test";

import { Scope, ScopeClosedError } from "../src/index.js";

test("a scope disposes effects once in reverse registration order", async () => {
  const scope = new Scope();
  const events: string[] = [];
  const first = scope.own(() => {
    events.push("first");
  });
  scope.own(async () => {
    await Promise.resolve();
    events.push("second");
  });

  await first();
  await first();
  await scope.dispose("finished");
  await scope.dispose();

  assert.deepEqual(events, ["first", "second"]);
  assert.equal(scope.state, "closed");
  assert.equal(scope.signal.aborted, true);
  assert.equal(scope.signal.reason, "finished");
});

test("disposing a parent disposes its children", async () => {
  const parent = new Scope();
  const child = parent.child();
  let disposed = false;
  child.own(() => {
    disposed = true;
  });

  await parent.dispose();

  assert.equal(disposed, true);
  assert.equal(child.state, "closed");
});

test("effect snapshots preserve labels and nested ownership", async () => {
  const scope = new Scope();
  scope.own(() => undefined, "database");
  const child = scope.child("worker");
  child.own(() => undefined, "timer");

  assert.deepEqual(scope.effects, [
    { label: "database", children: [] },
    { label: "worker", children: [{ label: "timer", children: [] }] },
  ]);

  await child.dispose();
  assert.deepEqual(scope.effects, [{ label: "database", children: [] }]);
  await scope.dispose();
});

test("a scope runs every cleanup before reporting failures", async () => {
  const scope = new Scope();
  const events: string[] = [];
  scope.own(() => {
    events.push("first");
    throw new Error("first failed");
  });
  scope.own(() => {
    events.push("second");
    throw new Error("second failed");
  });

  await assert.rejects(scope.dispose(), (error: unknown) => {
    assert(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(String), ["Error: second failed", "Error: first failed"]);
    return true;
  });
  assert.deepEqual(events, ["second", "first"]);
  assert.equal(scope.state, "closed");
});

test("a closed scope rejects new ownership", async () => {
  const scope = new Scope();
  await scope.dispose();

  assert.throws(() => scope.own(() => undefined), ScopeClosedError);
  assert.throws(() => scope.child(), ScopeClosedError);
});
