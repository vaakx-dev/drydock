import assert from "node:assert/strict";
import test from "node:test";

import {
  ConfigValidationError,
  Context,
  definePlugin,
  mount,
  token,
  type MountState,
} from "../src/index.js";

test("a plugin follows the availability of its required services", async () => {
  const context = Context.create();
  const message = token<string>("message");
  const events: string[] = [];
  const states: string[] = [];
  const plugin = definePlugin({
    name: "consumer",
    requires: [message],
    setup(current) {
      events.push(`start:${current.use(message)}`);
      return () => {
        events.push("stop");
      };
    },
  });
  const mounted = mount(context, plugin, undefined);
  mounted.subscribe((state) => states.push(state.status));
  await mounted.settled();
  assert.deepEqual(mounted.state, { status: "waiting", missing: [message] });

  const provider = context.provide(message, "hello");
  await mounted.settled();
  assert.equal(mounted.state.status, "active");

  await provider.dispose();
  await mounted.settled();
  assert.equal(mounted.state.status, "waiting");
  assert.deepEqual(events, ["start:hello", "stop"]);
  assert.deepEqual(states, ["waiting", "starting", "active", "stopping", "waiting"]);
  await context.dispose();
});

test("replacing a service recomposes dependent plugins", async () => {
  const context = Context.create();
  const value = token<number>("value");
  const provider = context.provide(value, 1);
  const seen: number[] = [];
  const mounted = mount(context, definePlugin({
    name: "reader",
    requires: [value],
    setup(current) {
      seen.push(current.use(value));
    },
  }), undefined);
  await mounted.settled();

  provider.replace(2);
  await mounted.settled();

  assert.deepEqual(seen, [1, 2]);
  assert.equal(mounted.state.status, "active");
  await context.dispose();
});

test("suspending a service pauses dependents without disposing its provider", async () => {
  const context = Context.create();
  const value = token<number>("value");
  const provider = context.provide(value, 1);
  const events: string[] = [];
  const mounted = mount(context, definePlugin({
    name: "readiness",
    requires: [value],
    setup(current) {
      events.push(`start:${current.use(value)}`);
      return () => {
        events.push("stop");
      };
    },
  }));
  await mounted.settled();

  provider.suspend();
  await mounted.settled();
  provider.replace(2);
  await mounted.settled();

  assert.equal(provider.available, false);
  assert.equal(mounted.state.status, "waiting");
  assert.deepEqual(events, ["start:1", "stop"]);

  provider.resume();
  await mounted.settled();

  assert.equal(provider.available, true);
  assert.equal(mounted.state.status, "active");
  assert.deepEqual(events, ["start:1", "stop", "start:2"]);
  await context.dispose();
});

test("optional services recompose a plugin without blocking activation", async () => {
  const context = Context.create();
  const label = token<string>("label");
  const unrelated = token<string>("unrelated");
  const events: string[] = [];
  const mounted = mount(context, definePlugin({
    name: "optional-reader",
    optional: [label],
    setup(current) {
      events.push(`start:${current.has(label) ? current.use(label) : "missing"}`);
      return () => {
        events.push("stop");
      };
    },
  }), undefined);
  await mounted.settled();

  const ignored = context.provide(unrelated, "ignored");
  await mounted.settled();
  const provider = context.provide(label, "first");
  await mounted.settled();
  provider.replace("second");
  await mounted.settled();
  await provider.dispose();
  await mounted.settled();

  assert.equal(mounted.state.status, "active");
  assert.deepEqual(events, [
    "start:missing",
    "stop",
    "start:first",
    "stop",
    "start:second",
    "stop",
    "start:missing",
  ]);
  await ignored.dispose();
  await context.dispose();
});

test("a service cannot be both required and optional", () => {
  const service = token<string>("service");

  assert.throws(() => definePlugin({
    name: "invalid",
    requires: [service],
    optional: [service],
    setup() {},
  }), /duplicate service dependencies/u);
});

test("plugin configuration can be validated and updated in place", async () => {
  const context = Context.create();
  const events: string[] = [];
  const plugin = definePlugin<number, string>({
    name: "configured",
    schema: {
      "~standard": {
        validate(value) {
          const parsed = Number(value);
          return Number.isFinite(parsed)
            ? { value: parsed }
            : { issues: [{ message: "expected a number" }] };
        },
      },
    },
    setup(_current, config) {
      events.push(`start:${config}`);
      return () => {
        events.push(`stop:${config}`);
      };
    },
  });
  const mounted = mount(context, plugin, "1");
  await mounted.settled();

  await mounted.update("2");
  await assert.rejects(mounted.update("invalid"), ConfigValidationError);

  assert.equal(mounted.state.status, "active");
  assert.deepEqual(events, ["start:1", "stop:1", "start:2"]);
  await context.dispose();
  assert.deepEqual(events, ["start:1", "stop:1", "start:2", "stop:2"]);
});

test("valid configuration can recover an initially invalid mount", async () => {
  const context = Context.create();
  let starts = 0;
  const plugin = definePlugin<string>({
    name: "recoverable-config",
    schema: {
      "~standard": {
        validate(value) {
          return value === "valid"
            ? { value }
            : { issues: [{ message: "invalid configuration", path: ["mode"] }] };
        },
      },
    },
    setup() {
      starts += 1;
    },
  });
  const mounted = mount(context, plugin, "invalid");
  await mounted.settled();

  assert.equal(mounted.state.status, "failed");
  if (mounted.state.status === "failed") {
    const { error } = mounted.state;
    assert.ok(error instanceof ConfigValidationError);
    assert.match(error.message, /mode/u);
  }

  await mounted.update("valid");

  assert.equal(mounted.state.status, "active");
  assert.equal(starts, 1);
  await context.dispose();
});

test("a failed configuration activation restores the previous configuration", async () => {
  const context = Context.create();
  const events: string[] = [];
  const mounted = mount(context, definePlugin<string>({
    name: "config-rollback",
    setup(_current, config) {
      events.push(`start:${config}`);
      if (config === "broken") throw new Error("broken configuration");
      return () => {
        events.push(`stop:${config}`);
      };
    },
  }), "stable");
  await mounted.settled();

  await assert.rejects(mounted.update("broken"), /broken configuration/u);

  assert.equal(mounted.state.status, "active");
  assert.deepEqual(events, [
    "start:stable",
    "stop:stable",
    "start:broken",
    "start:stable",
  ]);
  await context.dispose();
});

test("failed activation rolls back partial effects and can be restarted", async () => {
  const context = Context.create();
  const output = token<string>("output");
  let attempts = 0;
  let cleanups = 0;
  const mounted = mount(context, definePlugin({
    name: "fallible",
    setup(current) {
      attempts += 1;
      current.provide(output, "temporary");
      current.effect(() => {
        cleanups += 1;
      });
      if (attempts === 1) throw new Error("setup failed");
    },
  }), undefined);
  await mounted.settled();

  assert.equal(mounted.state.status, "failed");
  assert.equal(context.has(output), false);
  assert.equal(cleanups, 1);

  mounted.restart();
  await mounted.settled();
  assert.equal(mounted.state.status, "active");
  assert.equal(context.use(output), "temporary");
  assert.equal(attempts, 2);
  await context.dispose();
  assert.equal(cleanups, 2);
});

test("service plugins can activate waiting consumers", async () => {
  const context = Context.create();
  const service = token<string>("service");
  const consumer = mount(context, definePlugin({
    name: "consumer",
    requires: [service],
    setup(current) {
      assert.equal(current.use(service), "ready");
    },
  }), undefined);
  await consumer.settled();

  const provider = mount(context, definePlugin({
    name: "provider",
    setup(current) {
      current.provide(service, "ready");
    },
  }), undefined);
  await provider.settled();
  await consumer.settled();

  assert.equal(provider.state.status, "active");
  assert.equal(consumer.state.status, "active");
  await context.dispose();
});

test("disposing during setup aborts the activation before cleanup", async () => {
  const context = Context.create();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: string[] = [];
  const mounted = mount(context, definePlugin({
    name: "slow",
    async setup(current) {
      current.signal.addEventListener("abort", () => events.push("abort"), { once: true });
      await wait;
      return () => {
        events.push("cleanup");
      };
    },
  }), undefined);
  await waitForState(mounted, "starting");

  const disposal = mounted.dispose("stop");
  release();
  await disposal;

  assert.deepEqual(events, ["abort", "cleanup"]);
  assert.equal(mounted.state.status, "disposed");
  await context.dispose();
});

test("state subscriber failures do not change plugin lifecycle", async () => {
  const context = Context.create();
  const errors: unknown[] = [];
  const mounted = mount(context, definePlugin({
    name: "observed",
    setup() {},
  }), undefined);
  mounted.subscribe(() => {
    throw new Error("observer failed");
  }, (error) => errors.push(error));

  await mounted.settled();

  assert.equal(mounted.state.status, "active");
  assert.ok(errors.length > 0);
  await context.dispose();
});

async function waitForState(
  mounted: { readonly state: MountState; subscribe(listener: (state: MountState) => void): () => void },
  status: MountState["status"],
): Promise<void> {
  if (mounted.state.status === status) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = mounted.subscribe((state) => {
      if (state.status !== status) return;
      unsubscribe();
      resolve();
    });
  });
}
