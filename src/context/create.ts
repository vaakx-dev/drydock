import type { Scope } from '../scope/scope'
import { Watcher } from '../services/watcher'
import type { Context, ContextCore, Dispose } from './types'

const owners = new WeakMap<object, Scope>()

export const scopeOf = (ctx: ContextCore) => {
  const scope = owners.get(ctx)
  if (!scope) throw new Error('Not a drydock context')
  return scope
}

export const createContext = (scope: Scope): Context => {
  const { app, usage } = scope

  const own = (dispose: Dispose) => {
    const untrack = scope.track(dispose)
    return () => {
      untrack()
      return dispose()
    }
  }

  const emitted = (id: string) => {
    usage.emitted.add(id)
    return id
  }

  const reload = async (target: unknown) => {
    const found = [...app.scopes].find(candidate => candidate === target)
    if (found && found.kind !== 'plugin') throw new Error(`${found.name} is not a plugin, so it cannot be reloaded`)
    await found?.reload()
  }

  const core: ContextCore = {
    get scope() {
      return scope
    },
    get hot() {
      return scope.hot
    },
    provide(token, impl) {
      usage.provided.add(token.id)
      return own(scope.layer.provide(token.id, impl, scope))
    },
    get: token => scope.layer.resolve(token.id) as never,
    watch(token, use) {
      usage.watched.add(token.id)
      const watcher = new Watcher(scope, token.id, use)
      app.watchers.add(watcher)
      const dispose = own(() => {
        app.watchers.delete(watcher)
        watcher.release()
      })
      watcher.fire()
      return dispose
    },
    plugin: (plugin, config) => scope.mount({ plugin, config }),
    load: (path, config) => scope.mount({ path, config }),
    layer: () => scope.branch().ctx,
    on(event, handler, options) {
      usage.handled.add(event.id)
      return own(app.bus.on(event.id, handler, scope, options))
    },
    emit: (event, ...args) => app.bus.emit(emitted(event.id), args),
    waterfall: (event, ...args) => app.bus.waterfall(emitted(event.id), args) as never,
    bail: (event, ...args) => app.bus.bail(emitted(event.id), args) as never,
    effect: setup => own(setup() ?? (() => {})),
    busy: () => own(scope.hold()),
    report: error => app.report(scope, error),
    scopes: () => [...app.scopes],
    reload: (target = scope) => reload(target),
    settled: () => app.settled(),
    dispose: () => scope.dispose(),
  }

  const ctx = new Proxy(core, {
    get(target, key, receiver) {
      if (key in target || typeof key !== 'string') return Reflect.get(target, key, receiver)
      const token = scope.injection(key)
      return token && scope.layer.resolve(token.id)
    },
  }) as Context
  owners.set(ctx, scope)
  return ctx
}
