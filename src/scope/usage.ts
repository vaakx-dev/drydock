export class Usage {
  readonly provided = new Set<string>()
  readonly watched = new Set<string>()
  readonly handled = new Set<string>()
  readonly emitted = new Set<string>()

  reset() {
    for (const ids of [this.provided, this.watched, this.handled, this.emitted]) ids.clear()
  }
}
