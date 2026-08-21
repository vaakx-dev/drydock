import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packages = resolve(root, "packages");
const generated = [];

for (const entry of await readdir(packages, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  await inspect(resolve(packages, entry.name, "src"));
}

if (generated.length > 0) {
  throw new Error(`generated files found in source directories:\n${generated.join("\n")}`);
}

async function inspect(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(path);
    } else if (/\.(?:js|map)$|\.d\.ts$/u.test(entry.name)) {
      generated.push(relative(root, path));
    }
  }
}
