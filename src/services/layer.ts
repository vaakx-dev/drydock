import type { App } from '../app/app'
import type { Scope } from '../scope/scope'

export interface Provision {
  id: string
  impl: unknown
  scope: Scope
}

let ids = 0

export class Layer {
  readonly id = ++ids
  private provisions = new Map<string, Provision[]>()

  constructor(
    private app: App,
    readonly parent?: Layer,
  ) {}

  resolve(id: string): unknown {
    for (let layer: Layer | undefined = this; layer; layer = layer.parent) {
      const top = layer.provisions.get(id)?.at(-1)
      if (top) return top.impl
    }
  }

  provide(id: string, impl: unknown, scope: Scope) {
    const provision = { id, impl, scope }
    this.provisions.set(id, [...(this.provisions.get(id) ?? []), provision])
    this.app.changed(this, id)
    return () => {
      const rest = (this.provisions.get(id) ?? []).filter(entry => entry !== provision)
      if (rest.length) this.provisions.set(id, rest)
      else this.provisions.delete(id)
      this.app.changed(this, id)
    }
  }

  within(layer: Layer) {
    for (let current: Layer | undefined = this; current; current = current.parent) if (current === layer) return true
    return false
  }

  list() {
    return [...this.provisions.values()].flatMap(stack =>
      stack.map((provision, index) => ({ ...provision, active: index === stack.length - 1 })),
    )
  }
}
