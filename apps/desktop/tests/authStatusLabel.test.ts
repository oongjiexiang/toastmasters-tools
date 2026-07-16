import { describe, expect, it } from "vitest";
import { describeAuthStatus } from "../src/renderer/lib/authStatusLabel";

/**
 * Phase 16 (item 4) — `describeAuthStatus` maps the raw `{ basecamp, ti }`
 * AuthStatus (or its absence before the first status load completes) onto the
 * short label the DashboardHeader badge renders. It is a pure function (no
 * React, no DOM), so it is tested directly here without jsdom/RTL, matching
 * this package's `environment: "node"` vitest config.
 */
describe("describeAuthStatus maps AuthStatus onto the header badge label", () => {
  it("labels both cookies present as 'Logged in'", () => {
    expect(describeAuthStatus({ basecamp: true, ti: true })).toBe("Logged in");
  });

  it("labels only the Basecamp cookie present as 'Basecamp only'", () => {
    expect(describeAuthStatus({ basecamp: true, ti: false })).toBe("Basecamp only");
  });

  it("labels only the TI cookie present as 'TI only'", () => {
    expect(describeAuthStatus({ basecamp: false, ti: true })).toBe("TI only");
  });

  it("labels neither cookie present as 'Not logged in'", () => {
    expect(describeAuthStatus({ basecamp: false, ti: false })).toBe("Not logged in");
  });

  it("labels a null status (before the first AUTH_STATUS load completes) as 'Not logged in'", () => {
    expect(describeAuthStatus(null)).toBe("Not logged in");
  });
});
