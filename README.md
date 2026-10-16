# drydock

drydock is a plugin kernel for TypeScript apps that run on Bun or in the browser. An app built on drydock is a set of plugins. Each plugin provides services and handles events, and you can stop, restart or reload it while the rest of the app keeps running.

## Why use drydock

A plugin lists the services it needs, and drydock starts it once they exist. You can load plugins in any order. When a plugin replaces a service, drydock restarts the plugins that use it.

Everything a plugin registers belongs to that plugin: services, event handlers, effects and child plugins. When the plugin stops, drydock undoes these in reverse order. That's why reloading a plugin from disk is safe: the old version leaves no handlers or timers behind.

When a plugin throws, drydock marks it as failed, reports the error, and keeps the other plugins running. The inspector shows every plugin, its status, and the last 1,000 events.

Services and events are tokens: plain values with an id and a type, made with `service<T>(id)` and `event<F>(id)`. TypeScript checks every call that provides, injects, handles or emits them, and the inspector shows which tokens each plugin used.

drydock is 1,160 lines of TypeScript with no dependencies. The coding agent [sand](https://github.com/vaakx-dev/sand) is built on it: all 68 of sand's parts are drydock plugins, and sand loads plugins it writes for itself mid-conversation.

## Get started

drydock ships as TypeScript source, so you need Bun. Install it with `bun add github:vaakx-dev/drydock`. For the browser, import `drydock/browser`, which is the same kernel without loading plugins from disk. Then read [Concepts](docs/concepts.md), which covers tokens, contexts, plugins, services, events, layers and the inspector.

## Versions

drydock is in alpha, and the API can change between releases. Each GitHub release, such as `v0.1.0-alpha.1`, never changes. `main` has every change as soon as it's pushed.

## Docs

- [Concepts](docs/concepts.md)
- [Working on drydock](docs/development.md)
