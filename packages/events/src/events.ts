import type { Context, Dispose } from "@drydock/core";

type Listener = (...args: any[]) => unknown;

export type EventName<Schema extends object> = {
  [Name in keyof Schema]: Schema[Name] extends Listener ? Name : never;
}[keyof Schema] & PropertyKey;

export type EventListener<
  Schema extends object,
  Name extends EventName<Schema>,
> = Extract<Schema[Name], Listener>;

type EventArguments<
  Schema extends object,
  Name extends EventName<Schema>,
> = Parameters<EventListener<Schema, Name>>;

type EventResult<
  Schema extends object,
  Name extends EventName<Schema>,
> = ReturnType<EventListener<Schema, Name>>;

type WaterfallArguments<
  Schema extends object,
  Name extends EventName<Schema>,
> = EventArguments<Schema, Name> extends [...infer Args, (...args: any[]) => unknown]
  ? Args
  : never;

interface ListenerEntry {
  readonly callback: Listener;
  readonly filter?: (source: Context | undefined) => boolean;
}

interface EventCall {
  readonly source: Context | undefined;
  readonly name: PropertyKey;
  readonly args: unknown[];
}

export interface EventOptions {
  readonly prepend?: boolean;
  readonly filter?: (source: Context | undefined) => boolean;
}

export class Events<Schema extends object> {
  readonly #listeners = new Map<PropertyKey, ListenerEntry[]>();

  on<Name extends EventName<Schema>>(
    context: Context,
    name: Name,
    listener: EventListener<Schema, Name>,
    options: EventOptions = {},
  ): Dispose {
    const callback = listener as Listener;
    const entry: ListenerEntry = options.filter
      ? { callback, filter: options.filter }
      : { callback };
    let active = false;
    const dispose = context.effect(() => {
      if (!active) return;
      active = false;
      this.#remove(name, entry);
    });
    const listeners = this.#listeners.get(name) ?? [];
    if (!this.#listeners.has(name)) this.#listeners.set(name, listeners);
    if (options.prepend) listeners.unshift(entry);
    else listeners.push(entry);
    active = true;
    return dispose;
  }

  once<Name extends EventName<Schema>>(
    context: Context,
    name: Name,
    listener: EventListener<Schema, Name>,
    options: EventOptions = {},
  ): Dispose {
    let dispose: Dispose | undefined;
    const callback = ((...args: EventArguments<Schema, Name>) => {
      void dispose?.();
      return listener(...args);
    }) as EventListener<Schema, Name>;
    dispose = this.on(context, name, callback, options);
    return dispose;
  }

  emit<Name extends EventName<Schema>>(
    name: Name,
    ...args: EventArguments<Schema, Name>
  ): void;
  emit<Name extends EventName<Schema>>(
    source: Context,
    name: Name,
    ...args: EventArguments<Schema, Name>
  ): void;
  emit(...input: unknown[]): void {
    const { source, name, args } = eventCall(input);
    for (const listener of this.#snapshot(name, source)) listener(...args);
  }

  async parallel<Name extends EventName<Schema>>(
    name: Name,
    ...args: EventArguments<Schema, Name>
  ): Promise<void>;
  async parallel<Name extends EventName<Schema>>(
    source: Context,
    name: Name,
    ...args: EventArguments<Schema, Name>
  ): Promise<void>;
  async parallel(...input: unknown[]): Promise<void> {
    const { source, name, args } = eventCall(input);
    const results = await Promise.allSettled(
      this.#snapshot(name, source).map(async (listener) => listener(...args)),
    );
    const errors = results.flatMap((result) => (
      result.status === "rejected" ? [result.reason] : []
    ));
    if (errors.length > 0) throw new AggregateError(errors, `event failed: ${String(name)}`);
  }

  bail<Name extends EventName<Schema>>(
    name: Name,
    ...args: EventArguments<Schema, Name>
  ): EventResult<Schema, Name> | undefined;
  bail<Name extends EventName<Schema>>(
    source: Context,
    name: Name,
    ...args: EventArguments<Schema, Name>
  ): EventResult<Schema, Name> | undefined;
  bail(...input: unknown[]): unknown {
    const { source, name, args } = eventCall(input);
    for (const listener of this.#snapshot(name, source)) {
      const result = listener(...args);
      if (isResult(result)) return result;
    }
    return undefined;
  }

  async serial<Name extends EventName<Schema>>(
    name: Name,
    ...args: EventArguments<Schema, Name>
  ): Promise<Awaited<EventResult<Schema, Name>> | undefined>;
  async serial<Name extends EventName<Schema>>(
    source: Context,
    name: Name,
    ...args: EventArguments<Schema, Name>
  ): Promise<Awaited<EventResult<Schema, Name>> | undefined>;
  async serial(...input: unknown[]): Promise<unknown> {
    const { source, name, args } = eventCall(input);
    for (const listener of this.#snapshot(name, source)) {
      const result = await listener(...args);
      if (isResult(result)) return result;
    }
    return undefined;
  }

  waterfall<Name extends EventName<Schema>>(
    name: Name,
    ...args: [
      ...WaterfallArguments<Schema, Name>,
      fallback: (...args: WaterfallArguments<Schema, Name>) => EventResult<Schema, Name>,
    ]
  ): EventResult<Schema, Name>;
  waterfall<Name extends EventName<Schema>>(
    source: Context,
    name: Name,
    ...args: [
      ...WaterfallArguments<Schema, Name>,
      fallback: (...args: WaterfallArguments<Schema, Name>) => EventResult<Schema, Name>,
    ]
  ): EventResult<Schema, Name>;
  waterfall(...input: unknown[]): unknown {
    const { source, name, args } = eventCall(input);
    const fallback = args.pop() as Listener;
    const listeners = this.#snapshot(name, source);
    let index = 0;
    const next = (): unknown => {
      const listener = listeners[index];
      index += 1;
      return listener ? listener(...args, next) : fallback(...args);
    };
    return next();
  }

  listenerCount<Name extends EventName<Schema>>(name: Name): number {
    return this.#listeners.get(name)?.length ?? 0;
  }

  #snapshot(name: PropertyKey, source: Context | undefined): readonly Listener[] {
    return [...this.#listeners.get(name) ?? []]
      .filter((entry) => !entry.filter || entry.filter(source))
      .map((entry) => entry.callback);
  }

  #remove(name: PropertyKey, entry: ListenerEntry): void {
    const listeners = this.#listeners.get(name);
    if (!listeners) return;
    const index = listeners.indexOf(entry);
    if (index >= 0) listeners.splice(index, 1);
    if (listeners.length === 0) this.#listeners.delete(name);
  }
}

function eventCall(input: readonly unknown[]): EventCall {
  const [first, ...rest] = input;
  if (isPropertyKey(first)) return { source: undefined, name: first, args: rest };
  const [name, ...args] = rest;
  if (!isPropertyKey(name)) throw new TypeError("event name must be a property key");
  return { source: first as Context, name, args };
}

function isPropertyKey(value: unknown): value is PropertyKey {
  return typeof value === "string" || typeof value === "number" || typeof value === "symbol";
}

function isResult(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}
