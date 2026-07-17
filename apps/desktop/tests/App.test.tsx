// @vitest-environment jsdom
//
// Phase 22 item 2 (see specs/roadmap.md "## Phase 22"): the refresh console
// (`log`, its collapse state, and the `onRefreshLog` subscription) was lifted
// from `DashboardView` up to `App.tsx` so it survives navigating to the
// member-detail view and back — before this phase, `DashboardView` owned that
// state and unmounted (losing the log) on every view switch.
//
// Also covers item 3's Cancel button and the "Copy logs" button added to the
// console header.
//
// `../lib/api` is mocked at the module boundary (same approach as
// `DashboardView.test.tsx`/`main-ipc.test.ts`) so this exercises App's own
// wiring — not real IPC.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MemberSummary, MemberDetail } from "@toastmasters/core/queries";

const {
  getMembers,
  getAuthStatus,
  getDiff,
  getMember,
  refreshProgress,
  refreshMembership,
  cancelRefresh,
  logIn,
  logOut,
  downloadMembershipCsv,
  onRefreshLog,
  getCapturedListener,
} = vi.hoisted(() => {
  let capturedListener: ((line: string) => void) | null = null;
  return {
    getMembers: vi.fn(),
    getAuthStatus: vi.fn(),
    getDiff: vi.fn(),
    getMember: vi.fn(),
    refreshProgress: vi.fn(),
    refreshMembership: vi.fn(),
    cancelRefresh: vi.fn(),
    logIn: vi.fn(),
    logOut: vi.fn(),
    downloadMembershipCsv: vi.fn(),
    onRefreshLog: vi.fn((listener: (line: string) => void) => {
      capturedListener = listener;
      return () => {
        capturedListener = null;
      };
    }),
    getCapturedListener: () => capturedListener,
  };
});

vi.mock("../src/renderer/lib/api", () => ({
  getMembers,
  getAuthStatus,
  getDiff,
  getMember,
  refreshProgress,
  refreshMembership,
  cancelRefresh,
  logIn,
  logOut,
  downloadMembershipCsv,
  onRefreshLog,
}));

import { App } from "../src/renderer/App";

// jsdom does not implement scrollIntoView (used by RefreshConsole to keep the
// newest log line in view); polyfill it so mounting the console doesn't throw.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

const singlePathwayMember: MemberSummary = {
  email: "alice@example.com",
  name: "Alice Smith",
  title: "PM1",
  pathways: [
    {
      pathway: "Motivational Strategies",
      title: "PM1",
      nextLevel: "Level 2",
      remaining: 3,
      status: "in-progress",
    },
  ],
};

const memberDetail: MemberDetail = {
  email: "alice@example.com",
  name: "Alice Smith",
  title: "PM1",
  pathway: "Motivational Strategies",
  levels: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  getMembers.mockResolvedValue([singlePathwayMember]);
  getAuthStatus.mockResolvedValue({ basecamp: false, ti: false });
  getMember.mockResolvedValue(memberDetail);
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Pushes a line through the captured onRefreshLog listener, as main would
 *  over REFRESH_LOG during a real refresh. */
function emitLogLine(line: string) {
  const listener = getCapturedListener();
  if (!listener) throw new Error("onRefreshLog listener was never captured");
  act(() => {
    listener(line);
  });
}

describe("App — the refresh console survives navigating to member detail and back (Phase 22 item 2)", () => {
  it("keeps the console's log lines after navigating away and back, rather than clearing them on unmount", async () => {
    render(<App />);

    // Wait for the dashboard's member table to load.
    await screen.findByText("Alice Smith");

    emitLogLine("Step 1/3 — gathering the member overview list…");
    emitLogLine("Step 1/3 done — 1 members found.");

    expect(screen.getByText("Step 1/3 — gathering the member overview list…")).toBeInTheDocument();
    expect(screen.getByText("Step 1/3 done — 1 members found.")).toBeInTheDocument();

    // Navigate to the member-detail view.
    fireEvent.click(screen.getByText("Alice Smith").closest("tr")!);
    await screen.findByText("Motivational Strategies · Path progress: 0 of 0 levels approved");

    // The console (a sibling of both views in App.tsx) must still show the
    // exact same lines — proving it was never unmounted along with the old
    // DashboardView-owned state.
    expect(screen.getByText("Step 1/3 — gathering the member overview list…")).toBeInTheDocument();
    expect(screen.getByText("Step 1/3 done — 1 members found.")).toBeInTheDocument();

    // Navigate back to the dashboard.
    fireEvent.click(screen.getByRole("button", { name: /Back to dashboard/i }));
    await screen.findByText("Alice Smith");

    expect(screen.getByText("Step 1/3 — gathering the member overview list…")).toBeInTheDocument();
    expect(screen.getByText("Step 1/3 done — 1 members found.")).toBeInTheDocument();
  });
});

describe("App — the console's own collapse toggle is independent of ExpandCollapseToggle (Phase 22 item 2)", () => {
  it("collapsing the console does not affect the member table's expand/collapse state, and vice versa", async () => {
    const multiPathwayMember: MemberSummary = {
      email: "bob@example.com",
      name: "Bob Jones",
      title: "DTM",
      pathways: [
        {
          pathway: "Dynamic Leadership",
          title: "DL3",
          nextLevel: "Level 4",
          remaining: 1,
          status: "in-progress",
        },
        {
          pathway: "Engaging Humor",
          title: "EH2",
          nextLevel: "Level 3",
          remaining: 2,
          status: "in-progress",
        },
      ],
    };
    getMembers.mockResolvedValue([singlePathwayMember, multiPathwayMember]);

    render(<App />);
    await screen.findByText("Bob Jones");

    emitLogLine("Step 1/3 — gathering the member overview list…");

    // Expand the table's multi-pathway rows via ExpandCollapseToggle.
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("Dynamic Leadership")).toBeInTheDocument();

    // Collapse the console via its OWN toggle — the table's expanded rows
    // must be unaffected.
    fireEvent.click(screen.getByLabelText("Collapse console"));
    expect(screen.queryByText("Step 1/3 — gathering the member overview list…")).not.toBeInTheDocument();
    expect(screen.getByText("Dynamic Leadership")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeInTheDocument();

    // Re-expand the console — the table's own toggle state is untouched by it.
    fireEvent.click(screen.getByLabelText("Expand console"));
    expect(screen.getByText("Step 1/3 — gathering the member overview list…")).toBeInTheDocument();
    expect(screen.getByText("Dynamic Leadership")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeInTheDocument();

    // Now collapse the TABLE'S rows — the console must stay expanded.
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("Dynamic Leadership")).not.toBeInTheDocument();
    expect(screen.getByText("Step 1/3 — gathering the member overview list…")).toBeInTheDocument();
  });
});

describe("App — Cancel button (Phase 22 item 3)", () => {
  it("calls cancelRefresh() when clicked while a refresh is active, and is absent otherwise", async () => {
    let resolveRefresh!: () => void;
    refreshProgress.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    cancelRefresh.mockResolvedValue(undefined);

    render(<App />);
    await screen.findByText("Alice Smith");

    // No refresh active yet: no Cancel button, even though the console isn't
    // rendered at all until there's a log or an active refresh.
    expect(screen.queryByRole("button", { name: /Cancel/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Refresh Progress/i }));

    const cancelButton = await screen.findByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelButton);

    await waitFor(() => expect(cancelRefresh).toHaveBeenCalledTimes(1));

    // Let the in-flight refreshProgress() promise settle within act() so
    // React's resulting state update (setRefreshingProgress(false)) doesn't
    // leak into a later test.
    await act(async () => {
      resolveRefresh();
      await Promise.resolve();
    });
  });
});

describe("App — Copy logs button (Phase 22 item 2)", () => {
  it("copies the joined log lines to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<App />);
    await screen.findByText("Alice Smith");

    emitLogLine("line one");
    emitLogLine("line two");

    fireEvent.click(screen.getByRole("button", { name: /Copy logs/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("line one\nline two"));
  });
});
