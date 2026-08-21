import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { Context } from "@drydock/core";
import { Loader } from "@drydock/loader";
import { bunResolver } from "../src/index.js";

test("a Bun resolver loads TypeScript and invalidates it only when requested", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-bun-"));
  const module = join(directory, "plugin.ts");
  try {
    await writePlugin(module, "first");
    const resolve = bunResolver({ from: pathToFileURL(join(directory, "host.ts")) });

    const first = await resolve("./plugin.ts");
    await writePlugin(module, "second");
    const cached = await resolve("./plugin.ts");
    resolve.invalidate("./plugin.ts");
    const reloaded = await resolve("./plugin.ts");

    assert.equal(first.name, "first");
    assert.equal(cached.name, "first");
    assert.equal(reloaded.name, "second");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalidation reloads a plugin's local TypeScript dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-bun-"));
  const module = join(directory, "plugin.ts");
  const value = join(directory, "value.ts");
  try {
    await writeFile(value, "export const name = \"first\";\n", "utf8");
    await writeFile(module, [
      "import { name } from \"./value.ts\";",
      "export default { name, setup() {} };",
      "",
    ].join("\n"), "utf8");
    const resolve = bunResolver({ from: pathToFileURL(join(directory, "host.ts")) });

    const first = await resolve("./plugin.ts");
    await writeFile(value, "export const name = \"second\";\n", "utf8");
    const cached = await resolve("./plugin.ts");
    resolve.invalidate("./plugin.ts");
    const reloaded = await resolve("./plugin.ts");

    assert.equal(first.name, "first");
    assert.equal(cached.name, "first");
    assert.equal(reloaded.name, "second");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the resolver reports bundled source dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-bun-"));
  const module = join(directory, "plugin.ts");
  const value = join(directory, "value.ts");
  try {
    await writeFile(value, "export const name = \"first\";\n", "utf8");
    await writeFile(module, [
      "import { name } from \"./value.ts\";",
      "export default { name, setup() {} };",
      "",
    ].join("\n"), "utf8");
    const resolve = bunResolver({ from: pathToFileURL(join(directory, "host.ts")) });

    await resolve("./plugin.ts");

    assert.deepEqual(
      new Set(resolve.dependencies("./plugin.ts")),
      new Set([module, value]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a Bun resolver rejects a module without a plugin export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-bun-"));
  const module = join(directory, "plugin.ts");
  try {
    await writeFile(module, "export const value = 1;\n", "utf8");
    const resolve = bunResolver({ from: pathToFileURL(join(directory, "host.ts")) });

    await assert.rejects(resolve("./plugin.ts"), /does not export a plugin/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a loader force reloads changed TypeScript through the Bun resolver", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-bun-"));
  const module = join(directory, "plugin.ts");
  const events: string[] = [];
  const context = Context.create();
  try {
    await writeLifecyclePlugin(module, "first");
    const loader = new Loader(
      context,
      bunResolver({ from: pathToFileURL(join(directory, "host.ts")) }),
    );
    await loader.load([{
      id: "plugin",
      use: "./plugin.ts",
      config: { events },
    }]);

    await writeLifecyclePlugin(module, "second");
    await loader.reload();
    await context.dispose();

    assert.deepEqual(events, [
      "start:first",
      "stop:first",
      "start:second",
      "stop:second",
    ]);
  } finally {
    await context.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("bundled plugins retain shared Drydock type identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drydock-bun-"));
  const module = join(directory, "plugin.ts");
  const matches: boolean[] = [];
  const context = Context.create();
  try {
    await writeFile(module, [
      "import { Context } from \"@drydock/core\";",
      "export default {",
      "  name: \"identity\",",
      "  setup(context, config) {",
      "    config.matches.push(context instanceof Context);",
      "  },",
      "};",
      "",
    ].join("\n"), "utf8");
    const loader = new Loader(
      context,
      bunResolver({ from: pathToFileURL(join(directory, "host.ts")) }),
    );

    await loader.load([{
      id: "identity",
      use: "./plugin.ts",
      config: { matches },
    }]);

    assert.deepEqual(matches, [true]);
  } finally {
    await context.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

function writePlugin(path: string, name: string): Promise<void> {
  return writeFile(path, `export default { name: ${JSON.stringify(name)}, setup() {} };\n`, "utf8");
}

function writeLifecyclePlugin(path: string, version: string): Promise<void> {
  return writeFile(path, [
    "export default {",
    `  name: ${JSON.stringify(version)},`,
    "  setup(_context, config) {",
    `    config.events.push(${JSON.stringify(`start:${version}`)});`,
    "    return () => {",
    `      config.events.push(${JSON.stringify(`stop:${version}`)});`,
    "    };",
    "  },",
    "};",
    "",
  ].join("\n"), "utf8");
}
