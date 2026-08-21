import assert from "node:assert/strict";
import test from "node:test";

import { Context, definePlugin, registry, token, type Plugin } from "@drydock/core";

import { Loader } from "../src/index.js";

test("a loader composes declarative entries through a resolver", async () => {
  const context = Context.create();
  const service = token<string>("service");
  const events: string[] = [];
  const plugins = new Map<string, Plugin<unknown>>([
    ["provider", definePlugin({
      name: "provider",
      setup(current) {
        current.provide(service, "ready");
      },
    }) as Plugin<unknown>],
    ["consumer", definePlugin({
      name: "consumer",
      requires: [service],
      setup(current, config) {
        events.push(`${String(config)}:${current.use(service)}`);
      },
    })],
  ]);
  const loader = new Loader(context, (specifier) => requirePlugin(plugins, specifier));

  const snapshot = await loader.load([
    { id: "consumer", use: "consumer", config: "loaded" },
    { id: "provider", use: "provider" },
  ]);

  assert.deepEqual(snapshot.entries.map((entry) => entry.state.status), ["active", "active"]);
  assert.deepEqual(events, ["loaded:ready"]);
  await loader.close();
  await context.dispose();
});

test("loader-managed plugins share the core registry", async () => {
  const context = Context.create();
  const plugins = registry(context);
  let version = 1;
  const resolve = Object.assign(
    () => definePlugin({
      name: `managed-${version}`,
      setup() {},
    }) as Plugin<unknown>,
    {
      invalidate() {
        version += 1;
      },
    },
  );
  const loader = new Loader(context, resolve);

  await loader.load([{ id: "managed", use: "managed" }]);
  const firstId = plugins.snapshot.plugins[0]?.id;
  await loader.reload("managed");

  assert.equal(plugins.size, 1);
  assert.equal(plugins.snapshot.plugins[0]?.name, "managed-2");
  assert.notEqual(plugins.snapshot.plugins[0]?.id, firstId);
  await loader.close();
  assert.equal(plugins.size, 0);
  await context.dispose();
});

test("configuration replacement disposes the previous generation in reverse order", async () => {
  const context = Context.create();
  const events: string[] = [];
  const plugins = new Map<string, Plugin<unknown>>([
    ["tracked", definePlugin({
      name: "tracked",
      setup(_current, config) {
        events.push(`start:${String(config)}`);
        return () => {
          events.push(`stop:${String(config)}`);
        };
      },
    })],
  ]);
  const loader = new Loader(context, (specifier) => requirePlugin(plugins, specifier));
  await loader.load([
    { id: "first", use: "tracked", config: "first" },
    { id: "second", use: "tracked", config: "second" },
  ]);

  await loader.load([{ id: "third", use: "tracked", config: "third" }]);

  assert.deepEqual(events, [
    "start:first",
    "start:second",
    "stop:second",
    "stop:first",
    "start:third",
  ]);
  await context.dispose();
  assert.equal(loader.state.status, "closed");
});

test("reload invalidates active specifiers and reuses the current configuration", async () => {
  const context = Context.create();
  const events: string[] = [];
  let version = 1;
  const resolve = Object.assign(
    (_specifier: string) => definePlugin({
      name: `version-${version}`,
      setup(_current, config: unknown) {
        events.push(`start:${version}:${String(config)}`);
        const activeVersion = version;
        return () => {
          events.push(`stop:${activeVersion}`);
        };
      },
    }) as Plugin<unknown>,
    {
      invalidate() {
        version += 1;
      },
    },
  );
  const loader = new Loader(context, resolve);
  await loader.load([{ id: "extension", use: "extension", config: "kept" }]);

  await loader.reload();

  assert.deepEqual(events, ["start:1:kept", "stop:1", "start:2:kept"]);
  assert.equal(loader.state.status, "active");
  await context.dispose();
});

test("individual reload replaces one entry without restarting its peers", async () => {
  const context = Context.create();
  const events: string[] = [];
  const versions = new Map([
    ["first", 1],
    ["second", 1],
  ]);
  const resolve = Object.assign(
    (specifier: string) => {
      const version = versions.get(specifier);
      if (!version) throw new Error(`unknown plugin: ${specifier}`);
      return definePlugin({
        name: `${specifier}-${version}`,
        setup() {
          events.push(`start:${specifier}:${version}`);
          return () => {
            events.push(`stop:${specifier}:${version}`);
          };
        },
      }) as Plugin<unknown>;
    },
    {
      invalidate(specifier: string) {
        const version = versions.get(specifier);
        if (!version) throw new Error(`unknown plugin: ${specifier}`);
        versions.set(specifier, version + 1);
      },
    },
  );
  const loader = new Loader(context, resolve);
  await loader.load([
    { id: "first", use: "first" },
    { id: "second", use: "second" },
  ]);

  const snapshot = await loader.reload("first");

  assert.deepEqual(events, [
    "start:first:1",
    "start:second:1",
    "stop:first:1",
    "start:first:2",
  ]);
  assert.deepEqual(snapshot.entries.map((entry) => entry.id), ["first", "second"]);
  assert.deepEqual(snapshot.entries.map((entry) => entry.state.status), ["active", "active"]);
  await context.dispose();
});

test("failed individual reload restores its entry without restarting peers", async () => {
  const context = Context.create();
  const events: string[] = [];
  let broken = false;
  const stable = definePlugin({
    name: "stable",
    setup() {
      events.push("start:first");
      return () => {
        events.push("stop:first");
      };
    },
  }) as Plugin<unknown>;
  const peer = definePlugin({
    name: "peer",
    setup() {
      events.push("start:peer");
      return () => {
        events.push("stop:peer");
      };
    },
  }) as Plugin<unknown>;
  const resolve = Object.assign(
    (specifier: string) => {
      if (specifier === "peer") return peer;
      if (!broken) return stable;
      return definePlugin({
        name: "broken",
        setup() {
          throw new Error("individual reload failed");
        },
      }) as Plugin<unknown>;
    },
    {
      invalidate(specifier: string) {
        if (specifier === "first") broken = true;
      },
    },
  );
  const loader = new Loader(context, resolve);
  await loader.load([
    { id: "first", use: "first" },
    { id: "peer", use: "peer" },
  ]);

  await assert.rejects(loader.reload("first"), /plugin generation failed/u);

  assert.deepEqual(events, ["start:first", "start:peer", "stop:first", "start:first"]);
  assert.equal(loader.state.status, "failed");
  if (loader.state.status === "failed") {
    assert.deepEqual(
      loader.state.snapshot.entries.map((entry) => entry.state.status),
      ["active", "active"],
    );
  }
  await context.dispose();
});

test("an entry can be unloaded without restarting its peers", async () => {
  const context = Context.create();
  const events: string[] = [];
  const plugin = definePlugin({
    name: "tracked",
    setup(_current, config) {
      events.push(`start:${String(config)}`);
      return () => {
        events.push(`stop:${String(config)}`);
      };
    },
  }) as Plugin<unknown>;
  const loader = new Loader(context, () => plugin);
  await loader.load([
    { id: "first", use: "tracked", config: "first" },
    { id: "second", use: "tracked", config: "second" },
  ]);

  assert.equal(await loader.unload("first"), true);

  assert.deepEqual(events, ["start:first", "start:second", "stop:first"]);
  assert.deepEqual(
    loader.state.status === "active"
      ? loader.state.snapshot.entries.map((entry) => entry.id)
      : [],
    ["second"],
  );
  assert.equal(await loader.unload("first"), false);
  await context.dispose();
});

test("an entry can be added, updated, disabled, and enabled without restarting peers", async () => {
  const context = Context.create();
  const plugins = registry(context);
  const events: string[] = [];
  const tracked = definePlugin<unknown>({
    name: "tracked",
    setup(_current, config) {
      events.push(`start:${String(config)}`);
      return () => {
        events.push(`stop:${String(config)}`);
      };
    },
  }) as Plugin<unknown>;
  const loader = new Loader(context, () => tracked);
  await loader.load([
    { id: "first", use: "tracked", config: "one" },
    { id: "peer", use: "tracked", config: "peer" },
  ]);
  const firstId = plugins.snapshot.plugins[0]?.id;

  await loader.set({ id: "first", use: "tracked", config: "two" });

  assert.equal(plugins.id(plugins.get(firstId!)!), firstId);
  assert.deepEqual(events, [
    "start:one",
    "start:peer",
    "stop:one",
    "start:two",
  ]);

  await loader.set({ id: "first", use: "tracked", config: "two", disabled: true });
  await loader.set({ id: "first", use: "tracked", config: "three" });
  await loader.set({ id: "third", use: "tracked", config: "third" });

  assert.deepEqual(events, [
    "start:one",
    "start:peer",
    "stop:one",
    "start:two",
    "stop:two",
    "start:three",
    "start:third",
  ]);
  assert.deepEqual(loader.entries.map(({ id, disabled }) => [id, Boolean(disabled)]), [
    ["first", false],
    ["peer", false],
    ["third", false],
  ]);
  assert.deepEqual(
    loader.state.status === "active"
      ? loader.state.snapshot.entries.map(({ id }) => id)
      : [],
    ["first", "peer", "third"],
  );
  await context.dispose();
});

test("plugin groups can be loaded, disabled, enabled, and removed as one unit", async () => {
  const context = Context.create();
  const events: string[] = [];
  const plugin = definePlugin<unknown>({
    name: "grouped",
    setup(_current, config) {
      events.push(`start:${String(config)}`);
      return () => {
        events.push(`stop:${String(config)}`);
      };
    },
  }) as Plugin<unknown>;
  const loader = new Loader(context, () => plugin);
  await loader.load([
    { id: "base", use: "grouped", config: "base" },
    {
      id: "workers",
      entries: [
        { id: "first", use: "grouped", config: "first" },
        {
          id: "nested",
          entries: [{ id: "second", use: "grouped", config: "second" }],
        },
      ],
    },
  ]);

  assert.deepEqual(
    loader.state.status === "active"
      ? loader.state.snapshot.entries.map(({ id }) => id)
      : [],
    ["base", "workers/first", "workers/nested/second"],
  );

  await loader.setGroup({
    id: "workers",
    disabled: true,
    entries: [
      { id: "first", use: "grouped", config: "first" },
      { id: "nested", entries: [{ id: "second", use: "grouped", config: "second" }] },
    ],
  });
  await loader.setGroup({
    id: "workers",
    entries: [{ id: "third", use: "grouped", config: "third" }],
  });

  assert.deepEqual(
    loader.state.status === "active"
      ? loader.state.snapshot.entries.map(({ id }) => id)
      : [],
    ["base", "workers/third"],
  );
  assert.equal(await loader.removeGroup("workers"), 1);
  assert.deepEqual(loader.entries.map(({ id }) => id), ["base"]);
  assert.equal(events.filter((event) => event === "stop:base").length, 0);
  await context.dispose();
});

test("a failed reload and rollback removes only the unrecoverable entry", async () => {
  const context = Context.create();
  let stableStarts = 0;
  let recovered = false;
  const stable = definePlugin({
    name: "stable",
    setup() {
      stableStarts += 1;
      if (stableStarts > 1) throw new Error("rollback failed");
    },
  }) as Plugin<unknown>;
  const resolve = Object.assign(
    () => {
      if (recovered) {
        return definePlugin({ name: "recovered", setup() {} }) as Plugin<unknown>;
      }
      if (stableStarts === 0) return stable;
      return definePlugin({
        name: "broken",
        setup() {
          throw new Error("replacement failed");
        },
      }) as Plugin<unknown>;
    },
    { invalidate() {} },
  );
  const loader = new Loader(context, resolve);
  await loader.load([{ id: "extension", use: "extension" }]);

  await assert.rejects(
    loader.reload("extension"),
    /plugin reload and rollback failed/u,
  );
  const empty = await loader.reload();
  recovered = true;
  const restored = await loader.load([{ id: "extension", use: "extension" }]);

  assert.deepEqual(empty.entries, []);
  assert.equal(restored.entries[0]?.state.status, "active");
  await context.dispose();
});

test("failed reload restores the active plugin generation", async () => {
  const context = Context.create();
  const events: string[] = [];
  let broken = false;
  const stable = definePlugin({
    name: "stable",
    setup() {
      events.push("start:stable");
      return () => {
        events.push("stop:stable");
      };
    },
  }) as Plugin<unknown>;
  const resolve = Object.assign(
    () => broken
      ? definePlugin({
        name: "broken",
        setup() {
          throw new Error("reload failed");
        },
      }) as Plugin<unknown>
      : stable,
    {
      invalidate() {
        broken = true;
      },
    },
  );
  const loader = new Loader(context, resolve);
  await loader.load([{ id: "extension", use: "extension" }]);

  await assert.rejects(loader.reload(), /plugin generation failed/u);

  assert.deepEqual(events, ["start:stable", "stop:stable", "start:stable"]);
  assert.equal(loader.state.status, "failed");
  if (loader.state.status === "failed") {
    assert.equal(loader.state.snapshot.entries[0]?.state.status, "active");
  }
  await context.dispose();
});

test("resolution failures leave the active generation untouched", async () => {
  const context = Context.create();
  let starts = 0;
  const stable = definePlugin({
    name: "stable",
    setup() {
      starts += 1;
    },
  }) as Plugin<unknown>;
  const loader = new Loader(context, (specifier) => {
    if (specifier === "stable") return stable;
    throw new Error("missing plugin");
  });
  await loader.load([{ id: "stable", use: "stable" }]);

  await assert.rejects(loader.load([{ id: "missing", use: "missing" }]), /missing plugin/u);

  assert.equal(starts, 1);
  assert.equal(loader.state.status, "failed");
  await context.dispose();
});

test("activation failure restores the previous generation", async () => {
  const context = Context.create();
  const events: string[] = [];
  const stable = definePlugin({
    name: "stable",
    setup() {
      events.push("start:stable");
      return () => {
        events.push("stop:stable");
      };
    },
  }) as Plugin<unknown>;
  const broken = definePlugin({
    name: "broken",
    setup() {
      throw new Error("broken setup");
    },
  }) as Plugin<unknown>;
  const loader = new Loader(context, (specifier) => specifier === "stable" ? stable : broken);
  await loader.load([{ id: "stable", use: "stable" }]);

  await assert.rejects(
    loader.load([{ id: "broken", use: "broken" }]),
    /plugin generation failed/u,
  );

  assert.deepEqual(events, ["start:stable", "stop:stable", "start:stable"]);
  assert.equal(loader.state.status, "failed");
  if (loader.state.status === "failed") {
    assert.equal(loader.state.snapshot.entries[0]?.id, "stable");
    assert.equal(loader.state.snapshot.entries[0]?.state.status, "active");
  }
  await context.dispose();
});

test("closing a loader disposes its generation and rejects further loads", async () => {
  const context = Context.create();
  let cleaned = false;
  const plugin = definePlugin({
    name: "plugin",
    setup() {
      return () => {
        cleaned = true;
      };
    },
  }) as Plugin<unknown>;
  const loader = new Loader(context, () => plugin);
  await loader.load([{ id: "plugin", use: "plugin" }]);

  await loader.close();
  await loader.close();

  assert.equal(cleaned, true);
  assert.equal(loader.state.status, "closed");
  await assert.rejects(loader.load([]), /loader is closed/u);
  await assert.rejects(loader.setGroup({ id: "empty", entries: [] }), /loader is closed/u);
  await assert.rejects(loader.removeGroup("empty"), /loader is closed/u);
  await context.dispose();
});

test("a loader is closed even when plugin cleanup fails", async () => {
  const context = Context.create();
  const plugin = definePlugin({
    name: "broken-cleanup",
    setup() {
      return () => {
        throw new Error("cleanup failed");
      };
    },
  }) as Plugin<unknown>;
  const loader = new Loader(context, () => plugin);
  await loader.load([{ id: "broken-cleanup", use: "broken-cleanup" }]);

  await assert.rejects(loader.close(), /plugin generation cleanup failed/u);

  assert.equal(loader.state.status, "closed");
  await assert.rejects(loader.load([]), /loader is closed/u);
  await context.dispose();
});

test("state subscriber failures do not interrupt loader operations", async () => {
  const context = Context.create();
  const errors: unknown[] = [];
  const plugin = definePlugin({
    name: "observed",
    setup() {},
  }) as Plugin<unknown>;
  const loader = new Loader(context, () => plugin);
  loader.subscribe(() => {
    throw new Error("loader observer failed");
  }, (error) => errors.push(error));

  await loader.load([{ id: "observed", use: "observed" }]);

  assert.equal(loader.state.status, "active");
  assert.ok(errors.length > 0);
  await context.dispose();
});

function requirePlugin(
  plugins: ReadonlyMap<string, Plugin<unknown>>,
  specifier: string,
): Plugin<unknown> {
  const plugin = plugins.get(specifier);
  if (!plugin) throw new Error(`unknown plugin: ${specifier}`);
  return plugin;
}
