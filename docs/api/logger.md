---
layout: default
title: Logger API
description: Structured records, sinks, and contextual loggers.
permalink: /api/logger/
---

Package: `@drydock/logger`

## Types

```ts
type LogLevel = "debug" | "info" | "warn" | "error"
type LogFields = Readonly<Record<string, unknown>>
type LogSink = (record: LogRecord) => void

interface LogRecord {
  readonly timestamp: Date
  readonly level: LogLevel
  readonly message: string
  readonly fields: LogFields
}

interface LoggerOptions {
  readonly level?: LogLevel
  readonly fields?: LogFields
  readonly clock?: () => Date
}
```

## Logger

```ts
interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}
```

`child()` returns a logger with fields inherited by later records. The configured level filters records below the threshold.

## Factory and service token

```ts
const LOGGER: Token<Logger>

function createLogger(sink: LogSink, options?: LoggerOptions): Logger
```

## consoleSink()

```ts
interface ConsoleOutput {
  debug(...values: unknown[]): void
  info(...values: unknown[]): void
  warn(...values: unknown[]): void
  error(...values: unknown[]): void
}

function consoleSink(output?: ConsoleOutput): LogSink
```

The default output is `globalThis.console`. The sink selects the output method that matches each record level.
