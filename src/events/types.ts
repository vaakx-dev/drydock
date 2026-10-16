import type { Signature } from './token'

export type Args<F extends Signature> = Parameters<F>

export type Result<F extends Signature> = Awaited<ReturnType<F>>

export type Handler<F extends Signature> = (...args: Args<F>) => Result<F> | void | Promise<Result<F> | void>

export interface HookOptions {
  priority?: number
  before?: string[]
  after?: string[]
}
