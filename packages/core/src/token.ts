const TOKEN_TYPE: unique symbol = Symbol("drydock.token.type");

export interface Token<T> {
  readonly id: symbol;
  readonly name: string;
  readonly [TOKEN_TYPE]?: T;
}

export function token<T>(name: string): Token<T> {
  const normalized = name.trim();
  if (!normalized) throw new Error("token name is required");
  return Object.freeze({ id: Symbol(normalized), name: normalized });
}
