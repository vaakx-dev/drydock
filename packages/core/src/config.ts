export type ConfigPathSegment = PropertyKey | { readonly key: PropertyKey };

export interface ConfigIssue {
  readonly message: string;
  readonly path?: readonly ConfigPathSegment[];
}

export type ConfigResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly ConfigIssue[] };

export interface ConfigSchema<Input, Output = Input> {
  readonly "~standard": {
    readonly validate: (
      value: unknown,
    ) => ConfigResult<Output> | Promise<ConfigResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

export class ConfigValidationError extends TypeError {
  readonly name = "ConfigValidationError";

  constructor(readonly issues: readonly ConfigIssue[]) {
    super([
      "invalid plugin configuration",
      ...issues.map((issue) => {
        const path = issue.path?.map(pathKey).join(".");
        return path ? `${issue.message} at ${path}` : issue.message;
      }),
    ].join(": "));
  }
}

export async function validateConfig<Input, Output>(
  schema: ConfigSchema<Input, Output> | undefined,
  input: Input,
): Promise<Output> {
  if (!schema) return input as unknown as Output;
  const result = await schema["~standard"].validate(input);
  if (result.issues) throw new ConfigValidationError(result.issues);
  return result.value;
}

function pathKey(segment: ConfigPathSegment): string {
  return typeof segment === "object" && segment !== null
    ? String(segment.key)
    : String(segment);
}
