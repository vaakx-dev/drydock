import { expect, test } from 'bun:test'
import { createApp, definePlugin, event, inspector, inspectorPlugin, service, type Context } from '../src/index'

interface Greeter {
  greet(name: string): string
}

const greeter = service<Greeter>('test.greeter')
const format = event<(text: string) => string>('test.format')
const pick = event<(n: number) => number | undefined>('test.pick')

const shout = (ctx: Context<{ greeter: typeof greeter }>) => ctx.greeter.greet('world').toUpperCase()

test('tokens are frozen and identified by id', () => {
  const copy = service<Greeter>('test.greeter')
  expect(Object.isFrozen(greeter)).toBe(true)
  expect(copy).not.toBe(greeter)
  expect(copy).toEqual(greeter)
})

test('inject waits for the service and resolves through copies of the token', async () => {
  const lines: string[] = []
  const ctx = createApp()
  ctx.plugin(
    definePlugin({
      name: 'hello',
      inject: { greeter },
      async apply(ctx) {
        lines.push(await ctx.waterfall(format, shout(ctx)))
        lines.push(String(await ctx.bail(pick, 2)))
      },
    }),
  )
  ctx.plugin(
    definePlugin({
      name: 'formats',
      apply(ctx) {
        ctx.on(event<(text: string) => string>('test.format'), text => `${text}!`)
        ctx.on(pick, n => n * 10)
      },
    }),
  )
  await ctx.settled()
  expect(lines).toEqual([])
  ctx.provide(service<Greeter>('test.greeter'), { greet: name => `hello ${name}` })
  await ctx.settled()
  expect(lines).toEqual(['HELLO WORLD!', '20'])
  expect(ctx.get(greeter)?.greet('x')).toBe('hello x')
  expect((ctx as unknown as Record<string, unknown>).greeter).toBeUndefined()
  await ctx.dispose()
})

test('the inspector lists the token ids each scope used', async () => {
  const ctx = createApp()
  ctx.plugin(inspectorPlugin)
  ctx.plugin(
    definePlugin({
      name: 'user',
      inject: { greeter, inspector },
      apply(ctx) {
        ctx.watch(greeter, () => {})
        ctx.on(format, text => text)
        ctx.emit(pick, 1)
      },
    }),
  )
  await ctx.settled()
  const user = () => ctx.get(inspector)!.tree().children.find(node => node.name === 'user')!
  expect(user()).toMatchObject({ status: 'pending', missing: ['test.greeter'], injected: ['test.greeter', 'drydock.inspector'] })
  ctx.provide(greeter, { greet: name => name })
  await ctx.settled()
  expect(user()).toMatchObject({
    status: 'active',
    missing: [],
    provided: [],
    watched: ['test.greeter'],
    handled: ['test.format'],
    emitted: ['test.pick'],
  })
  await ctx.dispose()
})

test('types reject clashing inject names and mismatched values', () => {
  definePlugin({
    name: 'clash',
    // @ts-expect-error
    inject: { get: greeter },
    apply() {},
  })
  const ctx = createApp()
  // @ts-expect-error
  ctx.provide(greeter, { greet: 1 })
  // @ts-expect-error
  ctx.emit(format, 1)
  // @ts-expect-error
  ctx.on(format, (text: number) => text)
})
