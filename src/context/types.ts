import type { Event, Signature } from '../events/token'
import type { Args, Handler, HookOptions, Result } from '../events/types'
import type { AnyPlugin } from '../plugin/types'
import type { Scope, ScopeView } from '../scope/view'
import type { Implementation, Service } from '../services/token'

export type Dispose = () => void | Promise<void>

export interface ContextCore {
  readonly scope: ScopeView
  readonly hot: { data: Record<string, unknown> }
  provide<T>(token: Service<T>, impl: NoInfer<T>): Dispose
  get<T>(token: Service<T>): T | undefined
  watch<T>(token: Service<T>, use: (impl: T | undefined) => Dispose | void): Dispose
  plugin(plugin: AnyPlugin, config?: unknown): Scope
  load(path: string, config?: unknown): Scope
  layer(): Context
  on<F extends Signature>(event: Event<F>, handler: NoInfer<Handler<F>>, options?: HookOptions): Dispose
  emit<F extends Signature>(event: Event<F>, ...args: NoInfer<Args<F>>): void
  waterfall<F extends Signature>(event: Event<F>, ...args: NoInfer<Args<F>>): Promise<Result<F>>
  bail<F extends Signature>(event: Event<F>, ...args: NoInfer<Args<F>>): Promise<Result<F> | undefined>
  effect(setup: () => Dispose | void): Dispose
  busy(): Dispose
  report(error: unknown): void
  scopes(): ScopeView[]
  reload(target?: ScopeView): Promise<void>
  settled(): Promise<void>
  dispose(): Promise<void>
}

export type Injects = { readonly [prop: string]: Service<any> }

export type Context<I extends Injects = {}> = ContextCore & { readonly [K in keyof I]: Implementation<I[K]> }
