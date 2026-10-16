declare const type: unique symbol

export interface Service<T> {
  readonly kind: 'service'
  readonly id: string
  readonly [type]?: T
}

export type Implementation<S> = S extends Service<infer T> ? T : never

export const service = <T>(id: string): Service<T> => Object.freeze({ kind: 'service', id })
