/**
 * Minimal structured logger shared across @toastmasters/core (Phase 21).
 *
 * Four levels (`debug`/`info`/`warn`/`error`), each accepting an optional
 * structured `context` object. This exists to replace the scattered
 * `console.log`/`console.error` calls that were genuinely *diagnostic* logging
 * (CLI error paths, unexpected scraper failures) with one consistent shape.
 *
 * It deliberately does NOT replace the `ProgressReporter` callback seam
 * (`services/fetch.ts`, `services/membership.ts`, `helpers/api.ts`) or the
 * DB snapshot-summary lines (`helpers/db.ts`) — those are user-facing
 * CLI/IPC *output*, not logging, and Phase 7/12's tests assert their exact
 * shape. See `packages/core/tests/workspace.test.ts` for the framework-agnostic
 * guarantee this module (like the rest of core) must keep.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const CONSOLE_METHOD: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

function write(level: LogLevel, message: string, context?: LogContext): void {
  const prefix = `[${level}]`;
  const emit = CONSOLE_METHOD[level];
  if (context && Object.keys(context).length > 0) {
    emit(prefix, message, context);
  } else {
    emit(prefix, message);
  }
}

/**
 * The shared logger instance. There is deliberately no `@toastmasters/core/logger`
 * `exports` subpath — nothing outside `packages/core` imports this module, and
 * adding a subpath would mean also updating the hardcoded ten-subpath contract
 * asserted by `packages/core/tests/workspace.test.ts`. Consumers within core
 * import it via a plain relative path (e.g. `./logger` / `../logger`), the same
 * way `helpers/db.ts` imports `csv-parse` internals.
 */
export const logger: Logger = {
  debug: (message, context) => write("debug", message, context),
  info: (message, context) => write("info", message, context),
  warn: (message, context) => write("warn", message, context),
  error: (message, context) => write("error", message, context),
};
