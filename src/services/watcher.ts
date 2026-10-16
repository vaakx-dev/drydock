import type { Dispose } from '../context/types'
import type { Scope } from '../scope/scope'
import type { Layer } from './layer'

export type Use = (impl: any) => Dispose | void

export class Watcher {
  private started = false
  private current: unknown
  private cleanup: Dispose | void = undefined

  constructor(
    readonly scope: Scope,
    readonly id: string,
    private use: Use,
  ) {}

  sees(layer: Layer, id: string) {
    return id === this.id && this.scope.layer.within(layer)
  }

  fire() {
    const impl = this.scope.layer.resolve(this.id)
    if (this.started && impl === this.current) return
    this.started = true
    this.current = impl
    this.release()
    try {
      this.cleanup = this.use(impl)
    } catch (error) {
      this.scope.fail(error)
    }
  }

  release() {
    const cleanup = this.cleanup
    this.cleanup = undefined
    if (!cleanup) return
    try {
      const result = cleanup()
      if (result instanceof Promise) result.catch(error => this.scope.app.report(this.scope, error))
    } catch (error) {
      this.scope.app.report(this.scope, error)
    }
  }
}
