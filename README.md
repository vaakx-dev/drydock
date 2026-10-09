# drydock

A small plugin kernel for TypeScript. Plugins provide and consume typed services, talk over typed events, and run inside scopes that own everything they register, so a plugin can be stopped, restarted or hot-reloaded without leaking handlers or timers.

drydock is app-agnostic: it knows nothing about the application built on top of it. It has no runtime dependencies (the Bun entry uses `node:path` and `node:fs` for loading plugins from disk) and ships as TypeScript source, so you run it with Bun, which executes `.ts` directly.

## Install

```sh
bun add github:vaakx-dev/drydock
```

## Example

```ts
import { createApp, definePlugin, inspector } from 'drydock'

interface Greeter {
  greet(name: string): string
}

// Services and events are declared by augmenting drydock's registries.
declare module 'drydock' {
  interface Services {
    greeter: Greeter
  }
  interface Events {
    'greeting.format': (text: string) => string
  }
}

const greeter = definePlugin({
  name: 'greeter',
  apply(ctx) {
    ctx.provide('greeter', { greet: name => `Hello, ${name}` })
  },
})

const shout = definePlugin({
  name: 'shout',
  apply(ctx) {
    ctx.on('greeting.format', text => text.toUpperCase())
  },
})

const hello = definePlugin({
  name: 'hello',
  inject: ['greeter'], // stays pending until `greeter` exists; ctx.greeter is non-optional
  async apply(ctx) {
    console.log(await ctx.waterfall('greeting.format', ctx.greeter.greet('world')))
    ctx.effect(() => {
      const timer = setInterval(() => {}, 1000)
      return () => clearInterval(timer) // runs when the plugin stops
    })
  },
})

const ctx = createApp()
ctx.on('drydock.error', (scope, error) => console.error(`[${scope.name}]`, error))
ctx.plugin(inspector)
ctx.plugin(hello) // mount order does not matter
ctx.plugin(shout)
ctx.plugin(greeter)

await ctx.settled() // prints "HELLO, WORLD"
console.log(ctx.inspector?.tree().children.map(node => `${node.name}: ${node.status}`))
await ctx.dispose()
```

## Concepts

### App and context

`createApp()` returns the root `Context`. Every scope has its own `ctx`, and plugins receive theirs as the first argument to `apply`. Registrations made through a `ctx` (`provide`, `on`, `watch`, `effect`, `busy`, child plugins and layers) belong to that scope and are undone, in reverse order, when the scope stops or is disposed. Each of them also returns a `Dispose` function for undoing it early.

Services can be read as properties of the context: `ctx.greeter`.

### Plugins

```ts
definePlugin({
  name: string,
  description?: string,
  inject?: ServiceKey[],             // required services
  uses?: Record<string, string>,     // free-form metadata, shown by the inspector
  config?: StandardSchemaV1,         // any Standard Schema (zod, valibot, arktype, ...)
  apply(ctx, config) { ... },        // may be async
})
```

- `ctx.plugin(plugin, config?)` mounts a plugin object. `ctx.load(path, config?)` imports one from disk and mounts it (Bun entry only). Relative paths resolve from the directory of the nearest ancestor loaded from disk (or the working directory). Anything else is treated as a package specifier. A directory resolves through its `package.json` `exports`/`main`, and the module must default-export a plugin. Both return a `Scope` with `reload()` and `dispose()`.
- Before `apply`, `config` is validated against the schema. Validation failures throw `ConfigError`, which carries `issues`.
- Status goes `pending → starting → active`, and can end in `failed` or `disposed`. A plugin stays `pending` until every injected service resolves. If one of its injected services is replaced or removed, the plugin is stopped and started again (or goes back to `pending`).
- If `apply` throws, or one of the plugin's event handlers or watchers throws, the plugin's registrations are flushed, it is marked `failed`, and the error is reported. Other plugins keep running.
- `ctx.reload(scope?)` restarts a plugin. Plugins loaded from a path are evicted from the module cache and imported again. `ctx.hot.data` is an object that survives reloads of the same mount.
- `ctx.busy()` marks the scope as busy until the returned function is called. A restart or reload waits until the scope and its children are idle.

### Services

Declare a service by augmenting `Services` in `declare module 'drydock'`. Service names cannot clash with context methods (this is checked both in the types and at runtime).

- `ctx.provide(key, impl)` registers an implementation. Providers stack, so the latest one wins, and removing it brings back the one below.
- `ctx[key]` resolves the current implementation. It is typed as optional unless the key is listed in `inject`.
- `ctx.watch(key, impl => cleanup?)` calls back immediately with the current implementation (or `undefined`) and again whenever it changes. The returned cleanup runs before the next call.

### Layers

`ctx.layer()` creates a child scope with its own service layer. Services provided there shadow the parent's for that layer and anything mounted inside it, while the parent and sibling layers are unaffected. Use layers to run the same plugins against different service implementations.

### Events

Declare events by augmenting `Events` with function signatures.

- `ctx.on(name, handler, { priority?, before?, after? })` adds a handler. Handlers run in descending `priority`, and `before`/`after` name other plugins that a handler must run ahead of or behind.
- `ctx.emit(name, ...args)` calls every handler and does not wait for them.
- `ctx.waterfall(name, value, ...rest)` runs handlers in order and awaits each one. A handler that returns something other than `undefined` replaces `value`, and the final value is returned.
- `ctx.bail(name, ...args)` runs handlers in order and stops at the first result that isn't `undefined`, which it returns.

Built-in events: `drydock.status` (a scope changed status) and `drydock.error` (a scope reported an error). With no `drydock.error` handler, errors go to `console.error`.

### Other context methods

- `effect(setup)` runs `setup` and owns the cleanup it returns.
- `report(error)` reports an error against this scope.
- `scopes()` lists all scopes.
- `settled()` resolves once every scope's pending work has finished.
- `dispose()` tears down this scope and its children.
- `scope` is a read-only view of this scope: id, name, kind, status, error, parent, children, `missing()`.

### Inspector

`inspector` is a built-in plugin that provides the `inspector` service:

- `tree()`: the scope tree, with status, errors, injections and metadata.
- `services()`: providers in each layer, and which one is active.
- `hooks()`: event handlers in run order.
- `trace()`: the last 1000 event dispatches, with timing and the handlers that failed.

## Entry points

| Import | Contents |
| --- | --- |
| `drydock` | Kernel API, plus `createApp()` with a Bun plugin loader, `share()` and `evict()`. Resolves to `drydock/browser` under the `browser` condition. |
| `drydock/browser` | Kernel API, plus `createApp()` without a loader (`ctx.load` fails, `ctx.plugin` works). No Node or Bun APIs. |

Bun-only helpers:

- `share(modules)` installs a Bun plugin that rewrites imports of the named modules, in source files outside `node_modules`, to the absolute paths you give. Plugins loaded from elsewhere on disk then share one instance of, for example, `drydock` itself. Call it before loading plugins.
- `evict(dir)` removes modules under `dir` from the module cache.

Exported types: `Context`, `ContextCore`, `Dispose`, `Plugin`, `AnyPlugin`, `Services`, `ServiceKey`, `Events`, `EventName`, `Args`, `Result`, `Handler`, `HookOptions`, `TraceRecord`, `Scope`, `ScopeView`, `Kind`, `Status`, `StandardSchemaV1`, `StandardIssue`, `Inspector`, `ScopeNode`, `ServiceInfo`, `HookInfo`, `Loader`, `Source`.

## Development

```sh
bun install
bun run check   # tsc, strict
```
