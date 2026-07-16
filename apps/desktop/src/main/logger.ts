/**
 * A small structured logger for the Electron main process (Phase 21),
 * mirroring the shape of `@toastmasters/core/logger` (`debug`/`info`/`warn`/
 * `error`, each with an optional structured `context` object).
 *
 * This is a deliberate, small duplication rather than importing core's
 * logger directly: every file under `src/main` except `core.ts` itself must
 * stay free of any static `@toastmasters/core` import — main-bundle.test.ts
 * asserts this on the emitted bundle, because a static import would evaluate
 * core's `config.ts`/`paths.ts` (and freeze their env-derived consts) before
 * the bootstrap in `index.ts` can set `TOASTMASTERS_DATA_DIR` / load
 * credentials. `auth.ts` carries the identical constraint for the same
 * reason. Routing main-process logging through core's chunk would mean
 * calling `loadCore()` from places (e.g. `auth.ts`) that must never touch
 * core at all — not worth it for a logging call. See `./core.ts` and
 * `./auth.ts`'s header comments for the full invariant.
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
  const prefix = `[toastmasters]`;
  const emit = CONSOLE_METHOD[level];
  if (context && Object.keys(context).length > 0) {
    emit(prefix, message, context);
  } else {
    emit(prefix, message);
  }
}

/** The shared main-process logger instance. */
export const logger: Logger = {
  debug: (message, context) => write("debug", message, context),
  info: (message, context) => write("info", message, context),
  warn: (message, context) => write("warn", message, context),
  error: (message, context) => write("error", message, context),
};
