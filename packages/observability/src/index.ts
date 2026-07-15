import { randomUUID } from "node:crypto";

/**
 * Minimal structured JSON logger. One line per event, stable field names,
 * child loggers carry bound context (component, correlationId, orgId, ...).
 *
 * Rules (docs/security.md): never log secrets, tokens, or client content
 * bodies — log identifiers and correlation ids instead. OpenTelemetry export
 * can replace the sink later without changing call sites.
 */

export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

type Sink = (line: string) => void;

function emit(sink: Sink, level: string, base: LogFields, msg: string, fields?: LogFields): void {
  sink(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...base,
      ...fields,
    }),
  );
}

export function createLogger(base: LogFields = {}, sink: Sink = console.log): Logger {
  return {
    info: (msg, fields) => emit(sink, "info", base, msg, fields),
    warn: (msg, fields) => emit(sink, "warn", base, msg, fields),
    error: (msg, fields) => emit(sink, "error", base, msg, fields),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}

/** Correlation id for a cross-system workflow (command → outbox → job → side effect). */
export function newCorrelationId(): string {
  return randomUUID();
}
