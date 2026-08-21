import type { MountState, Plugin } from "@drydock/core";

export interface PluginEntry {
  readonly id: string;
  readonly use: string;
  readonly config?: unknown;
  readonly disabled?: boolean;
  readonly group?: string;
}

export interface PluginGroup {
  readonly id: string;
  readonly entries: readonly LoaderConfig[];
  readonly disabled?: boolean;
}

export type LoaderConfig = PluginEntry | PluginGroup;

export interface LoadedEntry {
  readonly id: string;
  readonly use: string;
  readonly state: MountState;
}

export interface LoaderSnapshot {
  readonly entries: readonly LoadedEntry[];
}

export type LoaderState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "active"; readonly snapshot: LoaderSnapshot }
  | { readonly status: "failed"; readonly error: unknown; readonly snapshot: LoaderSnapshot }
  | { readonly status: "closed" };

export interface PluginResolver {
  (specifier: string): Plugin<unknown> | Promise<Plugin<unknown>>;
  readonly invalidate?: (specifier: string) => void | Promise<void>;
}

export interface ReloadablePluginResolver extends PluginResolver {
  readonly invalidate: (specifier: string) => void | Promise<void>;
}

export function isReloadablePluginResolver(
  resolver: PluginResolver,
): resolver is ReloadablePluginResolver {
  return typeof resolver.invalidate === "function";
}
