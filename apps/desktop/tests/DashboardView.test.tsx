// @vitest-environment jsdom
//
// Phase 22 item 1 (see specs/roadmap.md "## Phase 22"): `reportRefreshError`
// stops showing the truncated raw message in the toast for an AUTH_ERROR
// (HTTP 401/403) failure. Instead the full error text goes into the
// persistent log console (via `setLog`) and the toast shows a fixed, friendly
// hint. Non-auth failures are unchanged: first line only in the toast,
// nothing added to the log.
//
// This also covers the `CANCELLED`-coded IpcError branch added alongside
// the Cancel button (item 3): it must show a neutral toast and never reach
// the auth-retry path at all.
//
// `../lib/api` is mocked at the module boundary (same "mock the module that
// crosses the boundary" approach as `main-ipc.test.ts`), so this exercises
// only DashboardView's own refresh-handling logic, not real IPC.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Providers } from "@toastmasters/ui/components/providers";
import { Toaster } from "@toastmasters/ui/components/ui/sonner";

// vi.mock's factory is hoisted above these top-level declarations, so the
// mock fns/class must be created inside vi.hoisted() to be safely referenced
// from within it (a plain `const x = vi.fn()` above would hit the TDZ).
const {
  getMembers,
  getAuthStatus,
  getDiff,
  refreshProgress,
  refreshMembership,
  logIn,
  logOut,
  downloadMembershipCsv,
  IpcError,
} = vi.hoisted(() => {
  class IpcError extends Error {
    readonly code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "IpcError";
      this.code = code;
    }
  }
  return {
    getMembers: vi.fn(),
    getAuthStatus: vi.fn(),
    getDiff: vi.fn(),
    refreshProgress: vi.fn(),
    refreshMembership: vi.fn(),
    logIn: vi.fn(),
    logOut: vi.fn(),
    downloadMembershipCsv: vi.fn(),
    IpcError,
  };
});

vi.mock("../src/renderer/lib/api", () => ({
  getMembers,
  getAuthStatus,
  getDiff,
  refreshProgress,
  refreshMembership,
  logIn,
  logOut,
  downloadMembershipCsv,
  IpcError,
}));

import { DashboardView } from "../src/renderer/views/DashboardView";

function renderDashboard() {
  const setLog = vi.fn();
  const setRefreshingProgress = vi.fn();
  const setRefreshingMembership = vi.fn();
  const setConsoleCollapsed = vi.fn();
  const onSelectMember = vi.fn();

  render(
    <Providers>
      <Toaster />
      <DashboardView
        onSelectMember={onSelectMember}
        setLog={setLog}
        refreshingProgress={false}
        setRefreshingProgress={setRefreshingProgress}
        refreshingMembership={false}
        setRefreshingMembership={setRefreshingMembership}
        setConsoleCollapsed={setConsoleCollapsed}
      />
    </Providers>,
  );

  return { setLog, setRefreshingProgress, setRefreshingMembership, setConsoleCollapsed, onSelectMember };
}

beforeEach(() => {
  vi.clearAllMocks();
  getMembers.mockResolvedValue([]);
  getAuthStatus.mockResolvedValue({ basecamp: false, ti: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DashboardView — reportRefreshError, AUTH_ERROR branch (Phase 22 item 1)", () => {
  it("shows the fixed hint toast (not the raw message) and appends the FULL error text to the log console", async () => {
    const fullMessage =
      "HTTP 401 Unauthorized for https://basecamp.toastmasters.org/api/bcm/progress/?club=abc&page=1";
    refreshProgress.mockRejectedValue(new Error(fullMessage));
    const { setLog } = renderDashboard();

    const refreshButton = await screen.findByRole("button", { name: /Refresh Progress/i });
    fireEvent.click(refreshButton);

    await screen.findByText(
      "Your Toastmasters session has expired. Log out and log in again to continue.",
    );
    // Negative control: the raw/truncated message must NOT be in the toast.
    expect(screen.queryByText(fullMessage)).not.toBeInTheDocument();

    await waitFor(() => expect(setLog).toHaveBeenCalledTimes(2));
    // First call clears the log at refresh start (setLog([])); the second is
    // the functional updater appending the full error text.
    const secondCallArg = setLog.mock.calls[1][0];
    expect(typeof secondCallArg).toBe("function");
    const appended = secondCallArg([]);
    expect(appended.join("\n")).toBe(fullMessage);
  });
});

describe("DashboardView — reportRefreshError, non-auth branch is unchanged (Phase 22 item 1 negative control)", () => {
  it("shows only the failure's first line in the toast and never touches the log console", async () => {
    refreshProgress.mockRejectedValue(new Error("network error\nsome stack trace detail"));
    const { setLog } = renderDashboard();

    const refreshButton = await screen.findByRole("button", { name: /Refresh Progress/i });
    fireEvent.click(refreshButton);

    await screen.findByText("network error");
    expect(
      screen.queryByText(
        "Your Toastmasters session has expired. Log out and log in again to continue.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/some stack trace detail/)).not.toBeInTheDocument();

    // Only the initial "clear the log" call — reportRefreshError never calls
    // setLog again for a non-auth failure.
    await waitFor(() => expect(setLog).toHaveBeenCalledTimes(1));
    expect(setLog).toHaveBeenCalledWith([]);
  });
});

describe("DashboardView — a CANCELLED refresh bypasses the auth-retry path entirely (Phase 22 item 3)", () => {
  it("shows a neutral 'Refresh cancelled' toast with no 'Log in again' action, and never touches the log console", async () => {
    refreshProgress.mockRejectedValue(new IpcError("Refresh cancelled.", "CANCELLED"));
    const { setLog } = renderDashboard();

    const refreshButton = await screen.findByRole("button", { name: /Refresh Progress/i });
    fireEvent.click(refreshButton);

    await screen.findByText("Refresh cancelled");
    expect(
      screen.queryByText(
        "Your Toastmasters session has expired. Log out and log in again to continue.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log in again" })).not.toBeInTheDocument();

    // reportRefreshError is never reached for a CANCELLED error, so setLog
    // only sees the initial "clear the log" call from handleRefreshProgress.
    await waitFor(() => expect(setLog).toHaveBeenCalledTimes(1));
    expect(setLog).toHaveBeenCalledWith([]);
  });
});
