import type { Layer } from '../services/layer'

export class Injections {
  private resolved = new Map<string, unknown>()

  constructor(
    private layer: Layer,
    readonly ids: () => string[],
  ) {}

  missing() {
    return this.ids().filter(id => this.layer.resolve(id) === undefined)
  }

  includes(id: string) {
    return this.ids().includes(id)
  }

  current() {
    return this.ids().every(id => {
      const impl = this.layer.resolve(id)
      return impl !== undefined && impl === this.resolved.get(id)
    })
  }

  capture() {
    this.resolved = new Map(this.ids().map(id => [id, this.layer.resolve(id)]))
  }

  clear() {
    this.resolved.clear()
  }
}
