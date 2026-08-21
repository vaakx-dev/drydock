import { token } from "@drydock/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, unknown>>;

export interface LogRecord {
  readonly timestamp: Date;
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: LogFields;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly fields?: LogFields;
  readonly clock?: () => Date;
}

const LEVELS: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const LOGGER = token<Logger>("logger");

export function createLogger(sink: LogSink, options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const clock = options.clock ?? (() => new Date());
  return logger(sink, level, clock, options.fields ?? {});
}

function logger(
  sink: LogSink,
  threshold: LogLevel,
  clock: () => Date,
  base: LogFields,
): Logger {
  const write = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (LEVELS[level] < LEVELS[threshold]) return;
    sink(Object.freeze({
      timestamp: clock(),
      level,
      message,
      fields: Object.freeze({ ...base, ...fields }),
    }));
  };

  return Object.freeze({
    log: write,
    debug: (message: string, fields?: LogFields) => write("debug", message, fields),
    info: (message: string, fields?: LogFields) => write("info", message, fields),
    warn: (message: string, fields?: LogFields) => write("warn", message, fields),
    error: (message: string, fields?: LogFields) => write("error", message, fields),
    child: (fields: LogFields) => logger(
      sink,
      threshold,
      clock,
      Object.freeze({ ...base, ...fields }),
    ),
  });
}
