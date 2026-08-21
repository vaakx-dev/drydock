interface Observer<Value> {
  readonly receive: (value: Value) => void;
  readonly reject?: (error: unknown) => void;
}

export class Observers<Value> {
  readonly #observers = new Set<Observer<Value>>();

  subscribe(
    receive: (value: Value) => void,
    reject?: (error: unknown) => void,
  ): () => void {
    const observer = reject ? { receive, reject } : { receive };
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  emit(value: Value): void {
    for (const observer of [...this.#observers]) {
      try {
        observer.receive(value);
      } catch (error) {
        try {
          observer.reject?.(error);
        } catch {}
      }
    }
  }
}
