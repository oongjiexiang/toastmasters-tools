import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../logger";

/**
 * Phase 21 — packages/core/logger.ts replaces the scattered console.log/
 * console.error calls with one consistent shape: level -> console method
 * routing, and a context-object presence check that changes call arity.
 *
 * These tests pin that routing and arity so a future refactor can't silently
 * swap, e.g., `warn` to `console.log`, or start passing an empty `{}` context
 * through to the console (which would change the literal stdout shape).
 */
describe("core logger routes each level to the matching console method", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("debug() calls console.debug, not any other console method", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.debug("hello");

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("info() calls console.log, not any other console method", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.info("hello");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("warn() calls console.warn, not any other console method", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.warn("hello");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("error() calls console.error, not any other console method", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("hello");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("core logger's message shape", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefixes every message with its level in brackets", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("something happened");

    expect(logSpy).toHaveBeenCalledWith("[info]", "something happened");
  });

  it("uses a distinct bracketed prefix per level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.debug("d");
    logger.warn("w");
    logger.error("e");

    expect(debugSpy).toHaveBeenCalledWith("[debug]", "d");
    expect(warnSpy).toHaveBeenCalledWith("[warn]", "w");
    expect(errorSpy).toHaveBeenCalledWith("[error]", "e");
  });
});

describe("core logger's context-object arity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes only (prefix, message) — no third argument — when context is omitted", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("no context here");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[info]", "no context here");
    expect(logSpy.mock.calls[0]).toHaveLength(2);
  });

  it("passes only (prefix, message) — no third argument — when context is an empty object", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("empty context", {});

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[info]", "empty context");
    expect(logSpy.mock.calls[0]).toHaveLength(2);
  });

  it("passes (prefix, message, context) — all three arguments — when context has keys", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("with context", { userId: 42 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[info]", "with context", { userId: 42 });
    expect(logSpy.mock.calls[0]).toHaveLength(3);
  });

  it("carries the non-empty-context arity through to error()", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("failed", { reason: "timeout" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[error]", "failed", { reason: "timeout" });
    expect(errorSpy.mock.calls[0]).toHaveLength(3);
  });
});
