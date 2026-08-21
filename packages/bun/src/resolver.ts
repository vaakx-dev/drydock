import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginResolver } from "@drydock/loader";

type ResolvedPlugin = Awaited<ReturnType<PluginResolver>>;

export interface BunResolverOptions {
  readonly external?: readonly string[];
  readonly from?: string | URL;
}

export interface BunResolver {
  (specifier: string): Promise<ResolvedPlugin>;
  invalidate(specifier: string): void;
}

export function bunResolver(options: BunResolverOptions = {}): BunResolver {
  const origin = options.from ?? resolve(process.cwd(), "package.json");
  const require = createRequire(toUrl(origin));
  const cache = new Map<string, Promise<ResolvedPlugin>>();
  let revision = 0;
  const load = async (specifier: string): Promise<ResolvedPlugin> => {
    const location = require.resolve(specifier);
    const cached = cache.get(location);
    if (cached) return cached;
    const pending = bundlePlugin(location, revision, options.external ?? []);
    cache.set(location, pending);
    try {
      return await pending;
    } catch (error) {
      if (cache.get(location) === pending) cache.delete(location);
      throw error;
    }
  };

  return Object.assign(load, {
    invalidate(specifier: string): void {
      const location = require.resolve(specifier);
      cache.delete(location);
      revision += 1;
    },
  });
}

async function bundlePlugin(
  location: string,
  revision: number,
  external: readonly string[],
): Promise<ResolvedPlugin> {
  const result = await Bun.build({
    entrypoints: [location],
    external: ["@drydock/*", ...external],
    format: "esm",
    packages: "external",
    target: "bun",
    throw: true,
  });
  const artifact = result.outputs.find((output) => output.kind === "entry-point");
  if (!artifact) throw new Error(`Bun did not produce a plugin bundle: ${location}`);
  const source = `${await artifact.text()}\n// drydock revision ${revision}\n`;
  const encoded = Buffer.from(source).toString("base64");
  const loaded = await import(`data:text/javascript;base64,${encoded}`) as unknown;
  const candidate = pluginExport(loaded);
  if (!candidate) throw new Error(`module does not export a plugin: ${location}`);
  return candidate;
}

function toUrl(origin: string | URL): URL {
  if (origin instanceof URL) return origin;
  if (origin.startsWith("file:")) return new URL(origin);
  return pathToFileURL(resolve(origin));
}

function pluginExport(value: unknown): ResolvedPlugin | undefined {
  if (isPlugin(value)) return value;
  if (typeof value !== "object" || value === null) return undefined;
  if ("default" in value && isPlugin(value.default)) return value.default;
  if ("plugin" in value && isPlugin(value.plugin)) return value.plugin;
  return undefined;
}

function isPlugin(value: unknown): value is ResolvedPlugin {
  return typeof value === "object"
    && value !== null
    && "name" in value
    && typeof value.name === "string"
    && "setup" in value
    && typeof value.setup === "function";
}
