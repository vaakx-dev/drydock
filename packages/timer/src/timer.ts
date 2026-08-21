import type { Context, Dispose } from "@drydock/core";

const MAX_DELAY = 2_147_483_647;

export class TimerCancelledError extends Error {
  constructor(readonly reason: unknown) {
    super("timer was cancelled", { cause: reason });
    this.name = "TimerCancelledError";
  }
}

export function timeout(context: Context, callback: () => void, delay: number): Dispose {
  validateDelay(delay);
  let release: Dispose | undefined;
  const handle = globalThis.setTimeout(() => {
    const current = release;
    release = undefined;
    void current?.();
    callback();
  }, delay);
  release = context.effect(() => globalThis.clearTimeout(handle));
  return async () => {
    const current = release;
    release = undefined;
    await current?.();
  };
}

export function interval(context: Context, callback: () => void, delay: number): Dispose {
  validateDelay(delay);
  const handle = globalThis.setInterval(callback, delay);
  return context.effect(() => globalThis.clearInterval(handle));
}

export function sleep(context: Context, delay: number): Promise<void> {
  validateDelay(delay);
  if (context.signal.aborted) {
    return Promise.reject(new TimerCancelledError(context.signal.reason));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let release: Dispose;
    const handle = globalThis.setTimeout(() => {
      settled = true;
      void release().then(resolve, reject);
    }, delay);
    release = context.effect(() => {
      globalThis.clearTimeout(handle);
      if (settled) return;
      settled = true;
      reject(new TimerCancelledError(context.signal.reason));
    });
  });
}

function validateDelay(delay: number): void {
  if (!Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY) {
    throw new RangeError(`timer delay must be between 0 and ${MAX_DELAY}`);
  }
}
