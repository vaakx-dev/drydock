import type { LoaderConfig, PluginEntry, PluginGroup } from "./types.js";

export function flattenConfig(config: readonly LoaderConfig[]): readonly PluginEntry[] {
  const entries: PluginEntry[] = [];
  flatten(config, "", false, entries);
  return entries;
}

export function inGroup(entry: PluginEntry, group: string): boolean {
  return entry.group === group || entry.group?.startsWith(`${group}/`) === true;
}

export function copyEntry(entry: PluginEntry): PluginEntry {
  return Object.freeze({ ...entry });
}

export function copyEntries(entries: readonly PluginEntry[]): readonly PluginEntry[] {
  return entries.map(copyEntry);
}

export function replaceConfig(
  entries: readonly PluginEntry[],
  index: number,
  entry: PluginEntry,
): readonly PluginEntry[] {
  return entries.map((current, currentIndex) => (
    copyEntry(currentIndex === index ? entry : current)
  ));
}

export function insertConfig(
  entries: readonly PluginEntry[],
  index: number,
  entry: PluginEntry,
): readonly PluginEntry[] {
  const result = [...copyEntries(entries)];
  result.splice(index, 0, copyEntry(entry));
  return result;
}

export function withoutConfig(
  entries: readonly PluginEntry[],
  id: string,
): readonly PluginEntry[] {
  return copyEntries(entries.filter((entry) => entry.id !== id));
}

export function validateEntries(entries: readonly PluginEntry[]): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id.trim()) throw new Error("plugin entry id is required");
    if (!entry.use.trim()) throw new Error(`plugin specifier is required: ${entry.id}`);
    if (ids.has(entry.id)) throw new Error(`duplicate plugin entry id: ${entry.id}`);
    ids.add(entry.id);
  }
}

function flatten(
  config: readonly LoaderConfig[],
  parent: string,
  disabled: boolean,
  entries: PluginEntry[],
): void {
  for (const item of config) {
    if (isGroup(item)) {
      const id = segment(item.id, "plugin group id is required");
      const path = parent ? `${parent}/${id}` : id;
      flatten(item.entries, path, disabled || Boolean(item.disabled), entries);
      continue;
    }
    const id = segment(item.id, "plugin entry id is required");
    const entry: PluginEntry = {
      ...item,
      id: parent ? `${parent}/${id}` : id,
      disabled: disabled || Boolean(item.disabled),
      ...(parent ? { group: parent } : {}),
    };
    entries.push(entry);
  }
}

function isGroup(config: LoaderConfig): config is PluginGroup {
  return "entries" in config;
}

function segment(value: string, message: string): string {
  const result = value.trim();
  if (!result) throw new Error(message);
  if (result.includes("/")) throw new Error(`configuration id cannot contain "/": ${result}`);
  return result;
}
