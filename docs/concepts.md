# Concepts

This page describes drydock's public API: tokens, contexts, plugins, services, layers, events and the inspector. It starts with a complete example, then covers each part.

## A complete example

```ts
import { createApp, definePlugin, event, inspector, inspectorPlugin, scopeError, service } from 'drydock'

interface Greeter {
  greet(name: string): string
}

// Services and events are tokens: values with an id and a type.
const greeter = service<Greeter>('example.greeter')
const format = event<(text: string) => string>('example.format')

const provider = definePlugin({
  name: 'greeter',
  apply(ctx) {
    ctx.provide(greeter, { greet: name => `Hello, ${name}` })
  },
})

const shout = definePlugin({
  name: 'shout',
  apply(ctx) {
    ctx.on(format, text => text.toUpperCase())
  },
})

const hello = definePlugin({
  name: 'hello',
  inject: { greeter }, // stays pending until the service exists; ctx.greeter is typed and required
  async apply(ctx) {
    console.log(await ctx.waterfall(format, ctx.greeter.greet('world')))
    ctx.effect(() => {
      const timer = setInterval(() => {}, 1000)
      return () => clearInterval(timer) // runs when the plugin stops
    })
  },
})

const ctx = createApp()
ctx.on(scopeError, (scope, error) => console.error(`[${scope.name}]`, error))
ctx.plugin(inspectorPlugin)
ctx.plugin(hello) // mount order does not matter
ctx.plugin(shout)
ctx.plugin(provider)

await ctx.settled() // prints "HELLO, WORLD"
console.log(ctx.get(inspector)?.tree().children.map(node => `${node.name}: ${node.status}`))
await ctx.dispose()
```

## Tokens

- `service<T>(id)` makes a `Service<T>` token, and `event<F>(id)` makes an `Event<F>` token, where `F` is the handler signature.
- A token is a small frozen object `{ kind, id }`. Its type parameter exists only for TypeScript.
- drydock identifies tokens by their `id` string, never by object identity, so two copies of a token with the same id are the same service or event. That keeps working when a module is evaluated again on reload. Pick ids that are unique across the app, such as `'package.name'`.
- `Implementation<typeof token>` gives a service token's type.

## App and context

`createApp()` returns the root `Context`. Every scope has its own `ctx`, and plugins receive theirs as the first argument to `apply`. Registrations made through a `ctx` (`provide`, `on`, `watch`, `effect`, `busy`, child plugins and layers) belong to that scope and are undone, in reverse order, when the scope stops or is disposed. Each of them also returns a `Dispose` function for undoing it early.

## Plugins

```ts
definePlugin({
  name: string,
  description?: string,
  inject?: { [prop]: Service<any> },  // required services, exposed as ctx[prop]
  config?: StandardSchemaV1,          // any Standard Schema (zod, valibot, arktype, ...)
  apply(ctx, config) { ... },         // may be async
})
```

- `ctx.plugin(plugin, config?)` mounts a plugin object. `ctx.load(path, config?)` imports one from disk and mounts it (Bun entry only). Relative paths resolve from the directory of the nearest ancestor loaded from disk (or the working directory). Anything else is treated as a package specifier. A directory resolves through its `package.json` `exports`/`main`, and the module must default-export a plugin. Both return a `Scope` with `reload()` and `dispose()`.
- Before `apply`, `config` is validated against the schema. Validation failures throw `ConfigError`, which carries `issues`.
- Status goes `pending → starting → active`, and can end in `failed` or `disposed`. A plugin stays `pending` until every injected service resolves. If one of its injected services is replaced or removed, the plugin is stopped and started again (or goes back to `pending`).
- If `apply` throws, or one of the plugin's event handlers or watchers throws, the plugin's registrations are flushed, it is marked `failed`, and the error is reported. Other plugins keep running.
- `ctx.reload(scope?)` restarts a plugin. Plugins loaded from a path are evicted from the module cache and imported again. `ctx.hot.data` is an object that survives reloads of the same mount.
- `ctx.busy()` marks the scope as busy until the returned function is called. A restart or reload waits until the scope and its children are idle.

### Injection

`inject` maps property names to service tokens. Each entry becomes a typed, required property of `ctx`, and only injected properties exist on `ctx`. Names that clash with `ctx` methods (`get`, `on`, `scope` and so on) are rejected by the types, and a plugin that uses one anyway fails when it starts.

To type a helper that receives a plugin's `ctx`, name the injections it needs with `Context<I>`. Any plugin `ctx` that injects at least those properties fits:

```ts
const greet = (ctx: Context<{ greeter: typeof greeter }>) => ctx.greeter.greet('world')

// or share the map between the plugin and its helpers
const inject = { greeter }
const greetAll = (ctx: Context<typeof inject>) => ctx.greeter.greet('everyone')
```

## Services

- `ctx.provide(token, impl)` registers an implementation. Providers stack, so the latest one wins, and removing it brings back the one below.
- `ctx.get(token)` returns the current implementation, or `undefined`.
- `ctx.watch(token, impl => cleanup?)` calls back immediately with the current implementation (or `undefined`) and again whenever it changes. The cleanup it returns runs before the next call.

## Layers

`ctx.layer()` creates a child scope with its own service layer. Services provided there shadow the parent's for that layer and anything mounted inside it, while the parent and sibling layers are unaffected. Use layers to run the same plugins against different service implementations.

## Events

An event token's type is its handler signature, so `event<(text: string) => string>(id)` takes a string and returns a string.

- `ctx.on(event, handler, { priority?, before?, after? })` adds a handler. Handlers run in descending `priority`, and `before`/`after` name other plugins that a handler must run ahead of or behind.
- `ctx.emit(event, ...args)` calls every handler and does not wait for them.
- `ctx.waterfall(event, value, ...rest)` runs handlers in order and awaits each one. A handler that returns something other than `undefined` replaces `value`, and the final value is returned.
- `ctx.bail(event, ...args)` runs handlers in order and stops at the first result that isn't `undefined`, which it returns.

Built-in events: `scopeStatus` (`drydock.status`, a scope changed status) and `scopeError` (`drydock.error`, a scope reported an error). With no `scopeError` handler, errors go to `console.error`.

## Other context methods

- `effect(setup)` runs `setup` and owns the cleanup it returns.
- `report(error)` reports an error against this scope.
- `scopes()` lists all scopes.
- `settled()` resolves once every scope's pending work has finished.
- `dispose()` tears down this scope and its children.
- `scope` is a read-only view of this scope: id, name, kind, status, error, parent, children, and `missing()`, the ids of injected services that don't resolve yet.

## Inspector

`inspectorPlugin` provides the `inspector` service (id `drydock.inspector`):

- `tree()`: the scope tree. Each node has its status and error, and the token ids it `provided`, `injected`, `watched`, `handled` and `emitted` during its current run, plus the injected ids that are `missing`.
- `services()`: providers in each layer by token id, and which one is active.
- `hooks()`: event handlers by token id, in run order.
- `trace()`: the last 1000 event dispatches, with timing and the handlers that failed.

## Entry points

| Import | Contents |
| --- | --- |
| `drydock` | Kernel API, plus `createApp()` with a Bun plugin loader, `share()` and `evict()`. Resolves to `drydock/browser` under the `browser` condition. |
| `drydock/browser` | Kernel API, plus `createApp()` without a loader (`ctx.load` fails, `ctx.plugin` works). No Node or Bun APIs. |

Bun-only helpers:

- `share(modules)` installs a Bun plugin that rewrites imports of the named modules, in source files outside `node_modules`, to the absolute paths you give. Plugins loaded from elsewhere on disk then share one instance of, for example, `drydock` itself. Call it before loading plugins.
- `evict(dir)` removes modules under `dir` from the module cache.

Exported types: `Context`, `ContextCore`, `Injects`, `Dispose`, `Plugin`, `AnyPlugin`, `Service`, `Implementation`, `Event`, `Signature`, `Args`, `Result`, `Handler`, `HookOptions`, `TraceRecord`, `Scope`, `ScopeView`, `Kind`, `Status`, `StandardSchemaV1`, `StandardIssue`, `Inspector`, `ScopeNode`, `ServiceInfo`, `HookInfo`, `Loader`, `Source`.
