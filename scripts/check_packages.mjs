import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagesRoot = join(root, "packages");
const publicApi = JSON.parse(await readFile(join(root, "scripts", "public-api.json"), "utf8"));
const entries = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const failures = [];

for (const directory of entries) {
  const packageRoot = join(packagesRoot, directory);
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const packageName = manifest.name;
  const exportRoot = manifest.exports?.["."];
  const typePath = resolve(packageRoot, exportRoot?.types ?? "");
  const importPath = resolve(packageRoot, exportRoot?.import ?? "");
  const declaration = await readText(typePath);

  if (!exportRoot?.types || !exportRoot?.import) {
    failures.push(`${packageName}: root exports must provide types and import targets`);
  }
  if (!(await exists(importPath)) || !(await exists(typePath))) {
    failures.push(`${packageName}: built export targets are missing`);
  }
  if (!(await exists(join(packageRoot, "README.md")))) {
    failures.push(`${packageName}: README.md is missing`);
  }
  if (!manifest.files?.includes("dist") || !manifest.files?.includes("README.md")) {
    failures.push(`${packageName}: files must include dist and README.md`);
  }
  if (/[/\\]src[/\\]/u.test(declaration)) {
    failures.push(`${packageName}: public declarations reference source paths`);
  }

  for (const symbol of publicApi[packageName] ?? []) {
    if (!new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "u").test(declaration)) {
      failures.push(`${packageName}: public symbol is missing from declarations: ${symbol}`);
    }
  }

  const pack = Bun.spawn(
    [process.execPath, "pm", "pack", "--dry-run", "--quiet"],
    { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    pack.exited,
    pack.stdout.text(),
    pack.stderr.text(),
  ]);
  if (exitCode !== 0) {
    failures.push(`${packageName}: pack check failed: ${stderr || stdout}`);
  }
}

if (failures.length > 0) {
  throw new Error(`package checks failed:\n${failures.join("\n")}`);
}

console.log(`checked ${entries.length} package artifacts and public APIs`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path) {
  return (await exists(path)) ? readFile(path, "utf8") : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\[\]\\]/gu, "\\$&");
}
