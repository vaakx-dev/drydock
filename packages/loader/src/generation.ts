import {
  isPlugin,
  mount,
  type Context,
  type MountedPlugin,
  type Plugin,
} from "@drydock/core";

import type { LoaderSnapshot, PluginEntry } from "./types.js";

export interface Definition {
  readonly entry: PluginEntry;
  readonly plugin: Plugin<unknown>;
}

export interface RuntimeEntry extends Definition {
  readonly mounted: MountedPlugin;
}

export async function activate(
  context: Context,
  definitions: readonly Definition[],
): Promise<RuntimeEntry[]> {
  const generation: RuntimeEntry[] = [];
  try {
    for (const definition of definitions) {
      generation.push({
        ...definition,
        mounted: mount(context, definition.plugin, definition.entry.config),
      });
    }
    await settleGeneration(generation);
    assertGeneration(generation);
    return generation;
  } catch (error) {
    try {
      await disposeGeneration(generation, error);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "plugin generation rollback failed");
    }
    throw error;
  }
}

export async function settleGeneration(generation: readonly RuntimeEntry[]): Promise<void> {
  const attempts = generation.length * 2 + 4;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const before = generation.map(({ mounted }) => mounted.state.status);
    await Promise.all(generation.map(({ mounted }) => mounted.settled()));
    await Promise.resolve();
    const after = generation.map(({ mounted }) => mounted.state.status);
    if (
      before.every((status, index) => status === after[index])
      && after.every((status) => status !== "starting" && status !== "stopping")
    ) return;
  }
  throw new Error("plugin generation did not settle");
}

export function assertGeneration(generation: readonly RuntimeEntry[]): void {
  const failures = generation.flatMap(({ entry, mounted }) => (
    mounted.state.status === "failed"
      ? [new Error(`plugin activation failed for ${entry.id}`, { cause: mounted.state.error })]
      : []
  ));
  if (failures.length > 0) throw new AggregateError(failures, "plugin generation failed");
}

export async function disposeGeneration(
  generation: readonly RuntimeEntry[],
  reason?: unknown,
): Promise<void> {
  const results = await Promise.allSettled(
    [...generation].reverse().map(({ mounted }) => mounted.dispose(reason)),
  );
  const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (failures.length > 0) throw new AggregateError(failures, "plugin generation cleanup failed");
}

export function snapshotOf(generation: readonly RuntimeEntry[]): LoaderSnapshot {
  return {
    entries: generation.map(({ entry, mounted }) => ({
      id: entry.id,
      use: entry.use,
      state: mounted.state,
    })),
  };
}

export function validateDefinition(definition: Definition): void {
  if (!isPlugin(definition.plugin)) {
    throw new Error(`resolved module is not a plugin: ${definition.entry.use}`);
  }
}
