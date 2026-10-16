import type { Context, ContextCore, Injects } from '../context/types'
import type { StandardSchemaV1 } from '../schema/standard'

type Reserved = { readonly [K in keyof ContextCore]?: never }

export interface Plugin<C = undefined, I extends Injects = {}> {
  name: string
  description?: string
  inject?: I & Reserved
  config?: StandardSchemaV1<unknown, C>
  apply(ctx: Context<I>, config: C): void | Promise<void>
}

export type AnyPlugin = Plugin<any, Injects>
