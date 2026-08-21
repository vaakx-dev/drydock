import assert from "node:assert/strict";
import test from "node:test";
import { Context, definePlugin, mount } from "@drydock/core";
import {
  LOGGER,
  consoleSink,
  createLogger,
  type LogRecord,
} from "../src/index.js";

const NOW = new Date("2026-01-02T03:04:05.000Z");

test("a logger filters records below its configured level", () => {
  const records: LogRecord[] = [];
  const logger = createLogger((record) => records.push(record), {
    level: "warn",
    clock: () => NOW,
  });

  logger.debug("hidden");
  logger.info("hidden");
  logger.warn("visible", { attempt: 2 });

  assert.deepEqual(records, [{
    timestamp: NOW,
    level: "warn",
    message: "visible",
    fields: { attempt: 2 },
  }]);
});

test("child loggers add stable context that call fields may refine", () => {
  const records: LogRecord[] = [];
  const root = createLogger((record) => records.push(record), {
    fields: { application: "host", request: "root" },
    clock: () => NOW,
  });

  root.child({ plugin: "worker", request: "child" }).info("started", {
    request: "call",
  });

  assert.deepEqual(records[0]?.fields, {
    application: "host",
    plugin: "worker",
    request: "call",
  });
});

test("the logger token provides logging through a plugin context", async () => {
  const records: LogRecord[] = [];
  const context = Context.create();
  context.provide(LOGGER, createLogger((record) => records.push(record), {
    clock: () => NOW,
  }));
  const mounted = mount(context, definePlugin({
    name: "logged",
    requires: [LOGGER],
    setup(pluginContext) {
      pluginContext.use(LOGGER).info("active", { plugin: "logged" });
    },
  }));

  await mounted.settled();

  assert.equal(mounted.state.status, "active");
  assert.equal(records[0]?.message, "active");
  await context.dispose();
});

test("the console sink selects the method for each record level", () => {
  const calls: Array<{ method: string; values: unknown[] }> = [];
  const output = {
    debug: (...values: unknown[]) => calls.push({ method: "debug", values }),
    info: (...values: unknown[]) => calls.push({ method: "info", values }),
    warn: (...values: unknown[]) => calls.push({ method: "warn", values }),
    error: (...values: unknown[]) => calls.push({ method: "error", values }),
  };
  const logger = createLogger(consoleSink(output), {
    level: "debug",
    clock: () => NOW,
  });

  logger.error("failed", { code: "E_TEST" });

  assert.equal(calls[0]?.method, "error");
  assert.deepEqual(calls[0]?.values, [
    "2026-01-02T03:04:05.000Z ERROR failed",
    { code: "E_TEST" },
  ]);
});
