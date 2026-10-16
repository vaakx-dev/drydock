declare const type: unique symbol

export type Signature = (...args: any[]) => any

export interface Event<F extends Signature> {
  readonly kind: 'event'
  readonly id: string
  readonly [type]?: F
}

export const event = <F extends Signature>(id: string): Event<F> => Object.freeze({ kind: 'event', id })
