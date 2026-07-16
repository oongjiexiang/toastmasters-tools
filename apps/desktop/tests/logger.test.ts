import { describe, expect, it, vi, afterEach } from "vitest";
import { logger } from "../src/main/logger";

/**
 * Phase 21 — apps/desktop/src/main/logger.ts mirrors the shape of
 * @toastmasters/core/logger (see that module's header comment for why this is
 * a deliberate small duplication, not a shared import: every file under
 * src/main except core.ts must stay free of any static @toastmasters/core
 * import, and main-bundle.test.ts asserts that on the emitted bundle).
 *
 * Unlike core's logger, every level here shares the same fixed
 * "[toastmasters]" prefix rather than a per-level one — that's the one
 * behavioural difference between the two copies, and it's pinned below.
 */
describe("desktop main logger routes each level to the matching console method", () => {
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

describe("desktop main logger's message shape", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefixes every message with the fixed '[toastmasters]' tag, regardless of level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(debugSpy).toHaveBeenCalledWith("[toastmasters]", "d");
    expect(logSpy).toHaveBeenCalledWith("[toastmasters]", "i");
    expect(warnSpy).toHaveBeenCalledWith("[toastmasters]", "w");
    expect(errorSpy).toHaveBeenCalledWith("[toastmasters]", "e");
  });
});

describe("desktop main logger's context-object arity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes only (prefix, message) — no third argument — when context is omitted", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("no context here");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[toastmasters]", "no context here");
    expect(logSpy.mock.calls[0]).toHaveLength(2);
  });

  it("passes only (prefix, message) — no third argument — when context is an empty object", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("empty context", {});

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[toastmasters]", "empty context");
    expect(logSpy.mock.calls[0]).toHaveLength(2);
  });

  it("passes (prefix, message, context) — all three arguments — when context has keys", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("with context", { basecamp: true, ti: false });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[toastmasters]", "with context", {
      basecamp: true,
      ti: false,
    });
    expect(logSpy.mock.calls[0]).toHaveLength(3);
  });

  it("carries the non-empty-context arity through to error()", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("login failed", { error: "invalid credentials" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[toastmasters]", "login failed", {
      error: "invalid credentials",
    });
    expect(errorSpy.mock.calls[0]).toHaveLength(3);
  });
});
