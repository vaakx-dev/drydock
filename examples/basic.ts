import { Context, definePlugin, token, type Plugin } from "@drydock/core";
import { Loader } from "@drydock/loader";

const greeting = token<string>("greeting");
const events: string[] = [];
const plugins = new Map<string, Plugin<unknown>>([
  ["provider", definePlugin<unknown>({
    name: "provider",
    setup(context, config) {
      context.provide(greeting, String(config));
    },
  })],
  ["consumer", definePlugin<unknown>({
    name: "consumer",
    requires: [greeting],
    setup(context) {
      events.push(`start:${context.use(greeting)}`);
      return () => {
        events.push("stop");
      };
    },
  })],
]);

const context = Context.create();
const loader = new Loader(context, (specifier) => {
  const plugin = plugins.get(specifier);
  if (!plugin) throw new Error(`unknown plugin: ${specifier}`);
  return plugin;
});

await loader.load([
  { id: "consumer", use: "consumer" },
  { id: "provider", use: "provider", config: "hello" },
]);
await loader.load([
  { id: "provider", use: "provider", config: "welcome" },
  { id: "consumer", use: "consumer" },
]);
await context.dispose();

console.log(JSON.stringify(events));
