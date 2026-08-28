# Drydock

Drydock is a TypeScript runtime that composes a host from scoped services and plugins.

Create a context, provide services, and load plugins. Each plugin declares the tokens it needs, runs `setup`, and owns its cleanup.

```ts
import { Context, definePlugin, token, type Plugin } from "@drydock/core";
import { Loader } from "@drydock/loader";

const greeting = token<string>("greeting");
const plugins = new Map<string, Plugin<unknown>>([
  ["provider", definePlugin<unknown>({
    name: "provider",
    setup(context, config) {
      context.provide(greeting, String(config));
    },
  })],
  ["consumer", definePlugin({
    name: "consumer",
    requires: [greeting],
    setup(context) {
      context.use(greeting);
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
  { id: "provider", use: "provider", config: "hello" },
  { id: "consumer", use: "consumer" },
]);
await context.dispose();
```

`examples/basic.ts` shows in-memory composition. `examples/bun_host.ts` loads a TypeScript plugin through `@drydock/bun`.

[Explore the wiki](docs/)
