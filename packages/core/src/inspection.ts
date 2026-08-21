import type { Context, ServiceSnapshot } from "./context.js";
import { registry, type RegisteredPlugin } from "./registry.js";

export interface RuntimeSnapshot {
  readonly services: readonly ServiceSnapshot[];
  readonly plugins: readonly RegisteredPlugin[];
}

export function inspect(context: Context): RuntimeSnapshot {
  return {
    services: context.services,
    plugins: registry(context).snapshot.plugins,
  };
}
