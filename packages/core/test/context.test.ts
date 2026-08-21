import assert from "node:assert/strict";
import test from "node:test";

import {
  Context,
  DuplicateServiceError,
  ServiceMissingError,
  token,
} from "../src/index.js";
import { observeServices } from "../src/context.js";

test("contexts inherit services and can shadow them locally", async () => {
  const root = Context.create();
  const message = token<string>("message");
  root.provide(message, "root");
  const child = root.child();

  assert.equal(child.use(message), "root");
  const local = child.provide(message, "child");
  assert.equal(child.use(message), "child");
  assert.equal(root.use(message), "root");

  await local.dispose();
  assert.equal(child.use(message), "root");
  await root.dispose();
});

test("providers can replace values without changing their identity", async () => {
  const context = Context.create();
  const count = token<number>("count");
  const provider = context.provide(count, 1);

  provider.replace(2);
  assert.equal(context.use(count), 2);
  provider.replace(2);
  assert.equal(context.use(count), 2);

  await provider.dispose();
  assert.equal(context.has(count), false);
  assert.throws(() => context.use(count), ServiceMissingError);
  await context.dispose();
});

test("a context allows one local provider for each token", async () => {
  const context = Context.create();
  const service = token<object>("service");
  context.provide(service, {});

  assert.throws(() => context.provide(service, {}), DuplicateServiceError);
  await context.dispose();
});

test("disposing a context removes its services and child effects", async () => {
  const root = Context.create();
  const child = root.child();
  const service = token<string>("service");
  child.provide(service, "value");
  let cleaned = false;
  child.effect(() => {
    cleaned = true;
  });

  await root.dispose();

  assert.equal(cleaned, true);
  assert.equal(root.state, "closed");
  assert.equal(child.state, "closed");
  assert.equal(child.has(service), false);
});

test("tokens with the same name remain distinct", async () => {
  const context = Context.create();
  const first = token<string>("value");
  const second = token<string>("value");
  context.provide(first, "first");

  assert.equal(context.has(first), true);
  assert.equal(context.has(second), false);
  await context.dispose();
});

test("isolated contexts hide selected ancestor services", async () => {
  const root = Context.create();
  const shared = token<string>("shared");
  const privateService = token<string>("private");
  root.provide(shared, "shared");
  root.provide(privateService, "root");
  const isolated = root.isolate(privateService);

  assert.equal(isolated.use(shared), "shared");
  assert.equal(isolated.has(privateService), false);
  assert.throws(() => isolated.use(privateService), ServiceMissingError);

  const local = isolated.provide(privateService, "isolated");
  assert.equal(isolated.use(privateService), "isolated");
  assert.equal(isolated.child().use(privateService), "isolated");
  assert.equal(root.use(privateService), "root");

  await local.dispose();
  assert.equal(isolated.has(privateService), false);
  await root.dispose();
});

test("service observers receive changes only for required tokens", async () => {
  const context = Context.create();
  const required = token<number>("required");
  const unrelated = token<number>("unrelated");
  let changes = 0;
  const dispose = observeServices(context, [required], () => {
    changes += 1;
  });

  const other = context.provide(unrelated, 1);
  other.replace(2);
  await other.dispose();
  assert.equal(changes, 0);

  const provider = context.provide(required, 1);
  provider.replace(2);
  await provider.dispose();
  assert.equal(changes, 3);

  await dispose();
  context.provide(required, 3);
  assert.equal(changes, 3);
  await context.dispose();
});

test("intercepted contexts transform a service without replacing its provider", async () => {
  const context = Context.create();
  const message = token<string>("message");
  const provider = context.provide(message, "hello");
  const upper = context.intercept(message, (value) => value.toUpperCase());
  const decorated = upper.intercept(message, (value) => `[${value}]`);

  assert.equal(context.use(message), "hello");
  assert.equal(upper.use(message), "HELLO");
  assert.equal(decorated.use(message), "[HELLO]");

  provider.replace("welcome");

  assert.equal(context.use(message), "welcome");
  assert.equal(decorated.use(message), "[WELCOME]");
  await decorated.dispose();
  await upper.dispose();
  await context.dispose();
});
