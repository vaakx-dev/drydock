import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Context, definePlugin } from "@drydock/core";
import { Loader, ReloadUnsupportedError } from "@drydock/loader";
import { watch, type HmrFailure } from "../src/index.js";

test("watcher reloads only entries affected by a changed source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-hmr-"));
  const firstFile = join(directory, "first.ts");
  const secondFile = join(directory, "second.ts");
  const events: string[] = [];
  const context = Context.create();
  const versions = new Map<string, number>([["first", 1], ["second", 1]]);
  const resolver = Object.assign((specifier: string) => {
    const version = versions.get(specifier);
    if (version === undefined) throw new Error(`unknown plugin: ${specifier}`);
    const plugin = definePlugin({
      name: `${specifier}-${version}`,
      setup() {
        events.push(`start:${specifier}:${version}`);
        return () => {
          events.push(`stop:${specifier}:${version}`);
        };
      },
    });
    return plugin;
  }, {
    invalidate(specifier: string) {
      versions.set(specifier, (versions.get(specifier) ?? 0) + 1);
    },
  });
  const loader = new Loader(context, resolver);

  try {
    await loader.load([
      { id: "first", use: "first" },
      { id: "second", use: "second" },
    ]);
    const watcher = watch(loader, {
      roots: [directory],
      debounceMs: 10,
      sources: (entry) => [entry.id === "first" ? firstFile : secondFile],
    });

    await writeFile(firstFile, "changed\n", "utf8");
    await waitFor(() => events.includes("start:first:2"));
    await watcher.close();

    assert.deepEqual(events, [
      "start:first:1",
      "start:second:1",
      "stop:first:1",
      "start:first:2",
    ]);
    assert.equal(watcher.state, "closed");
  } finally {
    await loader.close();
    await context.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("watcher rejects a loader without reload support", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-hmr-"));
  const context = Context.create();
  const loader = new Loader(context, () => definePlugin({ name: "static", setup() {} }));

  try {
    await loader.load([{ id: "static", use: "static" }]);
    assert.throws(
      () => watch(loader, { roots: [directory], sources: () => [] }),
      ReloadUnsupportedError,
    );
  } finally {
    await loader.close();
    await context.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("watcher reloads every active entry for an unknown file in a watched root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-hmr-"));
  const firstFile = join(directory, "first.ts");
  const secondFile = join(directory, "second.ts");
  const newFile = join(directory, "new.ts");
  const events: string[] = [];
  const context = Context.create();
  const versions = new Map<string, number>([["first", 1], ["second", 1]]);
  const resolver = Object.assign((specifier: string) => {
    const version = versions.get(specifier);
    if (version === undefined) throw new Error(`unknown plugin: ${specifier}`);
    return definePlugin({
      name: `${specifier}-${version}`,
      setup() {
        events.push(`start:${specifier}:${version}`);
        return () => {
          events.push(`stop:${specifier}:${version}`);
        };
      },
    });
  }, {
    invalidate(specifier: string) {
      versions.set(specifier, (versions.get(specifier) ?? 0) + 1);
    },
  });
  const loader = new Loader(context, resolver);

  try {
    await loader.load([
      { id: "first", use: "first" },
      { id: "second", use: "second" },
    ]);
    const watcher = watch(loader, {
      roots: [directory],
      debounceMs: 10,
      sources: (entry) => [entry.id === "first" ? firstFile : secondFile],
    });

    await writeFile(newFile, "new\n", "utf8");
    await waitFor(() => events.includes("start:first:2") && events.includes("start:second:2"));
    await watcher.close();

    assert.deepEqual(events, [
      "start:first:1",
      "start:second:1",
      "stop:first:1",
      "start:first:2",
      "stop:second:1",
      "start:second:2",
    ]);
  } finally {
    await loader.close();
    await context.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("watcher reports reload failures and keeps watching", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-hmr-"));
  const source = join(directory, "plugin.ts");
  const context = Context.create();
  let revision = 0;
  const failures: unknown[] = [];
  const loader = new Loader(context, Object.assign(
    () => definePlugin({
      name: "broken",
      setup() {
        revision += 1;
        if (revision > 1) throw new Error("reload failed");
      },
    }),
    { invalidate() {} },
  ));

  try {
    await loader.load([{ id: "plugin", use: "plugin" }]);
    const watcher = watch(loader, {
      roots: [directory],
      debounceMs: 10,
      sources: () => [source],
      onError: ({ error }) => failures.push(error),
    });

    await writeFile(source, "broken\n", "utf8");
    await waitFor(() => failures.length === 1);

    assert.equal(watcher.state, "open");
    assert.equal(loader.state.status, "failed");
    await watcher.close();
  } finally {
    await loader.close();
    await context.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("watcher reports source index failures after a reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-hmr-"));
  const source = join(directory, "plugin.ts");
  const context = Context.create();
  const failures: HmrFailure[] = [];
  let sourceCalls = 0;
  const loader = new Loader(context, Object.assign(
    () => definePlugin({ name: "source-errors", setup() {} }),
    { invalidate() {} },
  ));

  try {
    await loader.load([{ id: "plugin", use: "plugin" }]);
    const watcher = watch(loader, {
      roots: [directory],
      debounceMs: 10,
      sources: () => {
        sourceCalls += 1;
        if (sourceCalls > 1) throw new Error("source index failed");
        return [source];
      },
      onError: (failure) => failures.push(failure),
    });

    await writeFile(source, "changed\n", "utf8");
    await waitFor(() => failures.some(({ phase }) => phase === "sources"));

    assert.equal(watcher.state, "open");
    await watcher.close();
  } finally {
    await loader.close();
    await context.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("watcher reports source filter failures from filesystem callbacks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-hmr-"));
  const source = join(directory, "plugin.ts");
  const context = Context.create();
  const failures: HmrFailure[] = [];
  const loader = new Loader(context, Object.assign(
    () => definePlugin({ name: "filter-errors", setup() {} }),
    { invalidate() {} },
  ));

  try {
    await loader.load([{ id: "plugin", use: "plugin" }]);
    const watcher = watch(loader, {
      roots: [directory],
      debounceMs: 10,
      sources: () => [source],
      ignore: () => {
        throw new Error("source filter failed");
      },
      onError: (failure) => failures.push(failure),
    });

    await writeFile(source, "changed\n", "utf8");
    await waitFor(() => failures.some(({ phase }) => phase === "watch"));

    assert.equal(watcher.state, "open");
    await watcher.close();
  } finally {
    await loader.close();
    await context.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(predicate(), true, "timed out waiting for filesystem change");
}
