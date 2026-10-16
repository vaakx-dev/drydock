import type { Scope } from '../scope/scope'
import { scopeError } from './builtin'
import { order } from './order'
import type { HookOptions } from './types'

export interface Hook {
  id: string
  handler: (...args: any[]) => unknown
  scope: Scope
  priority: number
  before: string[]
  after: string[]
}

export interface TraceRecord {
  kind: 'emit' | 'waterfall' | 'bail'
  id: string
  at: number
  ms: number
  handlers: string[]
  failed: string[]
}

export class Bus {
  private hooks = new Map<string, Hook[]>()
  private ordered = new Map<string, Hook[]>()
  private observers = new Set<(record: TraceRecord) => void>()

  on(id: string, handler: Hook['handler'], scope: Scope, options: HookOptions = {}) {
    const hook = {
      id,
      handler,
      scope,
      priority: options.priority ?? 0,
      before: options.before ?? [],
      after: options.after ?? [],
    }
    this.update(id, [...(this.hooks.get(id) ?? []), hook])
    return () => this.update(id, (this.hooks.get(id) ?? []).filter(entry => entry !== hook))
  }

  has(id: string) {
    return Boolean(this.hooks.get(id)?.length)
  }

  ids() {
    return [...this.hooks.keys()]
  }

  list(id: string) {
    let hooks = this.ordered.get(id)
    if (!hooks) this.ordered.set(id, (hooks = order(this.hooks.get(id) ?? [])))
    return hooks
  }

  observe(observer: (record: TraceRecord) => void) {
    this.observers.add(observer)
    return () => void this.observers.delete(observer)
  }

  emit(id: string, args: unknown[]) {
    const { hooks, guard, end } = this.begin('emit', id)
    for (const hook of hooks) {
      try {
        const result = hook.handler(...args)
        if (result instanceof Promise) result.catch(error => this.fail(hook, error))
      } catch (error) {
        guard(hook, error)
      }
    }
    end()
  }

  async waterfall(id: string, args: unknown[]) {
    let [value, ...rest] = args
    await this.sequence('waterfall', id, async hook => {
      const next = await hook.handler(value, ...rest)
      if (next !== undefined) value = next
    })
    return value
  }

  async bail(id: string, args: unknown[]) {
    let result: unknown
    await this.sequence('bail', id, async hook => {
      result = await hook.handler(...args)
      return result !== undefined
    })
    return result
  }

  private async sequence(kind: TraceRecord['kind'], id: string, step: (hook: Hook) => Promise<boolean | void>) {
    const { hooks, guard, end } = this.begin(kind, id)
    for (const hook of hooks) {
      try {
        if (await step(hook)) break
      } catch (error) {
        guard(hook, error)
      }
    }
    end()
  }

  private begin(kind: TraceRecord['kind'], id: string) {
    const started = performance.now()
    const hooks = this.list(id)
    const failed: Hook[] = []
    return {
      hooks,
      guard: (hook: Hook, error: unknown) => {
        failed.push(hook)
        this.fail(hook, error)
      },
      end: () => this.record(kind, id, started, hooks, failed),
    }
  }

  private update(id: string, hooks: Hook[]) {
    if (hooks.length) this.hooks.set(id, hooks)
    else this.hooks.delete(id)
    this.ordered.delete(id)
  }

  private fail(hook: Hook, error: unknown) {
    if (hook.id === scopeError.id) console.error('[drydock] error handler failed:', error)
    else hook.scope.fail(error)
  }

  private record(kind: TraceRecord['kind'], id: string, started: number, hooks: Hook[], failed: Hook[]) {
    if (!this.observers.size) return
    const record = {
      kind,
      id,
      at: Date.now(),
      ms: performance.now() - started,
      handlers: hooks.map(hook => hook.scope.name),
      failed: failed.map(hook => hook.scope.name),
    }
    for (const observer of this.observers) observer(record)
  }
}
