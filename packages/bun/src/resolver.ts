import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
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
  dependencies(specifier: string): readonly string[];
}

interface Bundle {
  readonly plugin: ResolvedPlugin;
  readonly dependencies: readonly string[];
}

export function bunResolver(options: BunResolverOptions = {}): BunResolver {
  const origin = options.from ?? resolve(process.cwd(), "package.json");
  const resolveRequire = createRequire(toUrl(origin));
  const packageRequire = createRequire(import.meta.url);
  const runtimeRequire = requireWithFallback(resolveRequire, packageRequire);
  const cache = new Map<string, Promise<Bundle>>();
  const dependencyCache = new Map<string, readonly string[]>();
  const load = async (specifier: string): Promise<ResolvedPlugin> => {
    const location = resolveRequire.resolve(specifier);
    const cached = cache.get(location);
    if (cached) return (await cached).plugin;
    const pending = bundlePlugin(location, runtimeRequire, options.external ?? []);
    cache.set(location, pending);
    try {
      const bundle = await pending;
      dependencyCache.set(location, bundle.dependencies);
      return bundle.plugin;
    } catch (error) {
      if (cache.get(location) === pending) cache.delete(location);
      dependencyCache.delete(location);
      throw error;
    }
  };

  return Object.assign(load, {
    invalidate(specifier: string): void {
      const location = resolveRequire.resolve(specifier);
      cache.delete(location);
      dependencyCache.delete(location);
    },
    dependencies(specifier: string): readonly string[] {
      const location = resolveRequire.resolve(specifier);
      return dependencyCache.get(location) ?? [];
    },
  });
}

function requireWithFallback(
  primary: ReturnType<typeof createRequire>,
  fallback: ReturnType<typeof createRequire>,
): ReturnType<typeof createRequire> {
  return ((specifier: string) => {
    try {
      return primary(specifier);
    } catch (error) {
      if (!specifier.startsWith("@drydock/")) throw error;
      return fallback(specifier);
    }
  }) as ReturnType<typeof createRequire>;
}

async function bundlePlugin(
  location: string,
  require: ReturnType<typeof createRequire>,
  external: readonly string[],
): Promise<Bundle> {
  const result = await Bun.build({
    entrypoints: [location],
    external: ["@drydock/*", ...external],
    format: "cjs",
    metafile: true,
    packages: "external",
    target: "bun",
    throw: true,
  });
  const artifact = result.outputs.find((output) => output.kind === "entry-point");
  if (!artifact) throw new Error(`Bun did not produce a plugin bundle: ${location}`);
  const loaded = evaluateBundle(await artifact.text(), location, require);
  const candidate = pluginExport(loaded);
  if (!candidate) throw new Error(`module does not export a plugin: ${location}`);
  return {
    plugin: candidate,
    dependencies: dependencyPaths(result.metafile, location),
  };
}

interface CommonJsModule {
  exports: Record<string, unknown>;
}

type CommonJsFactory = (
  exports: Record<string, unknown>,
  require: ReturnType<typeof createRequire>,
  module: CommonJsModule,
  filename: string,
  dirname: string,
) => void;

function evaluateBundle(
  source: string,
  location: string,
  require: ReturnType<typeof createRequire>,
): unknown {
  const wrapperStart = source.indexOf("(function");
  if (wrapperStart < 0) throw new Error(`Bun did not produce an evaluable plugin bundle: ${location}`);
  const wrapper = source.slice(wrapperStart);
  const factory = new Function(`return ${wrapper}`)() as CommonJsFactory;
  const module: CommonJsModule = { exports: {} };
  factory(module.exports, require, module, location, dirname(location));
  return module.exports;
}

function dependencyPaths(metafile: unknown, entrypoint: string): readonly string[] {
  const parsed = typeof metafile === "string" ? parseMetafile(metafile) : metafile;
  if (!isRecord(parsed) || !isRecord(parsed.inputs)) return [entrypoint];
  return [...new Set([
    entrypoint,
    ...Object.keys(parsed.inputs).map(toAbsolutePath),
  ])];
}

function toAbsolutePath(path: string): string {
  const windowsPath = path.match(/(?:^|[/\\])([A-Za-z]:[\\/].*)$/u)?.[1];
  if (windowsPath) return windowsPath.replaceAll("/", "\\");
  return isAbsolutePath(path) ? path : resolve(path);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);
}

function parseMetafile(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
