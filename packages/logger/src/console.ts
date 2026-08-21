import type { LogLevel, LogSink } from "./logger.js";

export interface ConsoleOutput {
  debug(...values: unknown[]): void;
  info(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
}

export function consoleSink(output: ConsoleOutput = console): LogSink {
  const methods: Readonly<Record<LogLevel, (...values: unknown[]) => void>> = {
    debug: output.debug.bind(output),
    info: output.info.bind(output),
    warn: output.warn.bind(output),
    error: output.error.bind(output),
  };

  return (record) => {
    methods[record.level](
      `${record.timestamp.toISOString()} ${record.level.toUpperCase()} ${record.message}`,
      record.fields,
    );
  };
}
