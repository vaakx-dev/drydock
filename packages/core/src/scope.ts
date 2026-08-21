export type Cleanup = () => void | Promise<void>;

export type Dispose = () => Promise<void>;

export type ScopeState = "open" | "closing" | "closed";

export interface EffectSnapshot {
  readonly label: string;
  readonly children: readonly EffectSnapshot[];
}

interface OwnedEffect {
  readonly label: string;
  readonly scope?: Scope;
}

export class ScopeClosedError extends Error {
  constructor() {
    super("scope is not open");
    this.name = "ScopeClosedError";
  }
}

export class Scope {
  readonly #controller = new AbortController();
  readonly #effects = new Map<Dispose, OwnedEffect>();
  readonly #parentDispose: Dispose | undefined;
  #state: ScopeState = "open";
  #disposal?: Promise<void>;
  #reason: unknown;

  constructor(parent?: Scope, label = "scope") {
    this.#parentDispose = parent
      ? parent.#own(
        () => this.#dispose(this.#reason ?? parent.signal.reason),
        label,
        this,
      )
      : undefined;
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get state(): ScopeState {
    return this.#state;
  }

  get effects(): readonly EffectSnapshot[] {
    return [...this.#effects.values()].map(({ label, scope }) => ({
      label,
      children: scope?.effects ?? [],
    }));
  }

  own(cleanup: Cleanup, label = "anonymous"): Dispose {
    return this.#own(cleanup, label);
  }

  #own(cleanup: Cleanup, label: string, scope?: Scope): Dispose {
    this.#assertOpen();
    let active = true;
    const dispose = async () => {
      if (!active) return;
      active = false;
      this.#effects.delete(dispose);
      await cleanup();
    };
    this.#effects.set(dispose, scope ? { label, scope } : { label });
    return dispose;
  }

  child(label = "scope"): Scope {
    this.#assertOpen();
    return new Scope(this, label);
  }

  cancel(reason?: unknown): void {
    if (!this.signal.aborted) this.#controller.abort(reason);
  }

  dispose(reason?: unknown): Promise<void> {
    if (this.#disposal) return this.#disposal;
    this.#reason = reason;
    if (this.#parentDispose) return this.#parentDispose();
    return this.#dispose(reason);
  }

  #dispose(reason?: unknown): Promise<void> {
    if (this.#disposal) return this.#disposal;
    this.#state = "closing";
    this.cancel(reason);
    this.#disposal = this.#disposeEffects();
    return this.#disposal;
  }

  async #disposeEffects(): Promise<void> {
    const errors: unknown[] = [];
    const effects = [...this.#effects.keys()].reverse();
    this.#effects.clear();
    for (const dispose of effects) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#state = "closed";
    if (errors.length > 0) throw new AggregateError(errors, "scope cleanup failed");
  }

  #assertOpen(): void {
    if (this.#state !== "open") throw new ScopeClosedError();
  }
}
