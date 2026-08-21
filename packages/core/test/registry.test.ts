import assert from "node:assert/strict";
import test from "node:test";

import {
  Context,
  definePlugin,
  mount,
  registry,
} from "../src/index.js";

test("a registry tracks every mount and reusable plugin instance", async () => {
  const context = Context.create();
  const plugins = registry(context);
  let starts = 0;
  const plugin = definePlugin({
    name: "reusable",
    setup() {
      starts += 1;
    },
  });

  const first = mount(context, plugin);
  const second = mount(context, plugin);
  await Promise.all([first.settled(), second.settled()]);

  const firstId = plugins.id(first);
  const secondId = plugins.id(second);
  assert.notEqual(firstId, undefined);
  assert.notEqual(secondId, undefined);
  assert.notEqual(firstId, secondId);
  assert.equal(plugins.size, 2);
  assert.deepEqual(
    plugins.snapshot.plugins.map(({ name, state }) => [name, state.status]),
    [["reusable", "active"], ["reusable", "active"]],
  );

  assert.equal(plugins.restart(firstId!), true);
  await first.settled();
  assert.equal(starts, 3);
  assert.equal(await plugins.dispose(firstId!), true);
  assert.equal(plugins.size, 1);
  await context.dispose();
  assert.equal(plugins.size, 0);
});

test("plugins mounted from a plugin context are nested in its lifetime", async () => {
  const context = Context.create();
  const plugins = registry(context);
  const child = definePlugin({
    name: "child",
    setup() {},
  });
  const parent = definePlugin({
    name: "parent",
    setup(current) {
      mount(current, child);
    },
  });

  const mounted = mount(context, parent);
  await mounted.settled();
  await Promise.all(plugins.snapshot.plugins.map(({ id }) => plugins.get(id)?.settled()));

  assert.deepEqual(
    plugins.snapshot.plugins.map(({ name }) => name),
    ["parent", "child"],
  );

  await mounted.dispose();
  assert.equal(plugins.size, 0);
  await context.dispose();
});

test("registry subscribers cannot interrupt mount registration", async () => {
  const context = Context.create();
  const plugins = registry(context);
  const errors: unknown[] = [];
  plugins.subscribe(() => {
    throw new Error("registry observer failed");
  }, (error) => errors.push(error));

  const mounted = mount(context, definePlugin({
    name: "observed",
    setup() {},
  }));
  await mounted.settled();

  assert.equal(plugins.size, 1);
  assert.ok(errors.length > 0);
  await context.dispose();
});

test("registry snapshots expose plugin-owned effects", async () => {
  const context = Context.create();
  const plugins = registry(context);
  const mounted = mount(context, definePlugin({
    name: "effects",
    setup(current) {
      current.effect(() => undefined, "socket");
    },
  }));
  await mounted.settled();

  assert.deepEqual(plugins.snapshot.plugins[0]?.effects, [
    { label: "socket", children: [] },
  ]);
  await context.dispose();
});

test("a registry controls every mount of one plugin definition", async () => {
  const context = Context.create();
  const plugins = registry(context);
  let starts = 0;
  const plugin = definePlugin({
    name: "shared-definition",
    setup() {
      starts += 1;
    },
  });
  const first = mount(context, plugin);
  const second = mount(context, plugin);
  await Promise.all([first.settled(), second.settled()]);

  assert.deepEqual(plugins.mounts(plugin), [first, second]);
  assert.equal(plugins.restartAll(plugin), 2);
  await Promise.all([first.settled(), second.settled()]);
  assert.equal(starts, 4);
  assert.equal(await plugins.disposeAll(plugin), 2);
  assert.equal(plugins.size, 0);
  await context.dispose();
});
