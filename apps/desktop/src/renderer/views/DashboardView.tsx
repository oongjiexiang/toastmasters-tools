import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CircleCheck, CircleDashed, Download, FileDown, LogIn, LogOut } from "lucide-react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { MemberTable } from "@/components/MemberTable";
import { DiffSection } from "@/components/DiffSection";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  downloadMembershipCsv,
  downloadProgressCsv,
  getAuthStatus,
  getDiff,
  getMembers,
  IpcError,
  logIn,
  logOut,
  refreshMembership,
  refreshProgress,
  type AuthStatus,
  type MemberSummary,
} from "../lib/api";
import { describeAuthStatus } from "../lib/authStatusLabel";

/** A failed refresh whose message looks like an expired/invalid session. */
const AUTH_ERROR = /HTTP 40[13]/;

interface DashboardViewProps {
  onSelectMember: (email: string, pathway: string) => void;
  /**
   * The refresh console's state, lifted to `App.tsx` (Phase 22) so it survives
   * navigating away from this view. Reads/writes go through these props instead
   * of local `useState` — the refresh orchestration below is unchanged. This
   * view only ever *writes* the log (clearing it, or appending the full error
   * text on an auth failure); the console that *reads* it back lives in
   * `App.tsx`/`RefreshConsole`, so no `log` value prop is needed here.
   */
  setLog: React.Dispatch<React.SetStateAction<string[]>>;
  refreshingProgress: boolean;
  setRefreshingProgress: React.Dispatch<React.SetStateAction<boolean>>;
  refreshingMembership: boolean;
  setRefreshingMembership: React.Dispatch<React.SetStateAction<boolean>>;
  /** Forces the console open when a new refresh starts. */
  setConsoleCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

export function DashboardView({
  onSelectMember,
  setLog,
  refreshingProgress,
  setRefreshingProgress,
  refreshingMembership,
  setRefreshingMembership,
  setConsoleCollapsed,
}: DashboardViewProps) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [latestSnapshotAt, setLatestSnapshotAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  /**
   * Loads the member table. An empty database (SNAPSHOT_MISSING) is not an error
   * here — it renders the friendly "No data yet" card, which tells the user to
   * refresh. Only genuine failures set `error`.
   */
  async function loadMembers() {
    try {
      const { members: rows, latestSnapshotAt: snapshotAt } = await getMembers();
      setMembers(rows);
      setLatestSnapshotAt(snapshotAt);
      setError(null);
    } catch (e) {
      if (e instanceof IpcError && e.code === "SNAPSHOT_MISSING") {
        setMembers([]);
        setLatestSnapshotAt(null);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load data");
      }
    }
  }

  // Load the table once on mount. loadMembers closes over stable setters only.
  useEffect(() => {
    void loadMembers();
  }, []);

  /** Loads the current auth status. Leaves the prior (possibly stale) status in
   *  place on failure rather than erroring the whole dashboard over it. */
  async function loadAuthStatus() {
    try {
      setAuthStatus(await getAuthStatus());
    } catch {
      /* leave stale status rather than erroring the whole dashboard */
    }
  }

  // Load the auth badge once on mount, alongside the member table.
  useEffect(() => {
    void loadAuthStatus();
  }, []);

  /** Runs the in-app login flow with a loading→result toast, reloading the table
   *  on success. Returns whether any credential was obtained. */
  async function handleLogin(): Promise<boolean> {
    const id = toast.loading("Waiting for Toastmasters login...");
    try {
      const status = await logIn();
      if (status.basecamp || status.ti) {
        toast.success("Signed in to Toastmasters — now use the Refresh buttons to load data", {
          id,
        });
        await loadMembers();
        await loadAuthStatus();
        return true;
      }
      // Phase 27: distinguish "the Basecamp login window gave up after
      // exhausting its auto-reload retries on Basecamp's own crash" from a
      // plain zero-cookie result, so the user isn't left with a silent
      // "not logged in" — point them at the manual fallback instead.
      if (status.basecampGaveUp) {
        toast.error(
          "Basecamp didn't finish signing in. Try Log in again, or use Open Credentials File… to paste the cookie manually.",
          { id },
        );
        await loadAuthStatus();
        return false;
      }
      toast.error("No cookies captured — the login did not complete.", { id });
      await loadAuthStatus();
      return false;
    } catch (e) {
      toast.error(e instanceof Error ? e.message.split("\n")[0] : "Login failed", {
        id,
      });
      return false;
    }
  }

  /** Clears the Toastmasters session with a loading→result toast, refreshing
   *  the auth badge on completion (success or failure). */
  async function handleLogout() {
    const id = toast.loading("Signing out...");
    try {
      const status = await logOut();
      setAuthStatus(status);
      toast.success("Logged out", { id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message.split("\n")[0] : "Logout failed", {
        id,
      });
    }
  }

  /**
   * Reports a failed refresh. An auth-shaped failure (HTTP 401/403) means
   * either the session expired, or the user never logged in at all — those
   * are different situations and get different copy:
   *
   *   - Not logged in: "Log in to Toastmasters first, then Refresh", with no
   *     action button (an "action" framing is wrong for a first-time state;
   *     the header's own "Log in" button is the call to action).
   *   - Already logged in (session genuinely expired): today's message,
   *     unchanged, with the "Log in again" action that logs in and retries
   *     the same refresh.
   *
   * Either way, the full error text goes into the persistent log console
   * (rather than being truncated in the toast). Non-auth failures are
   * unchanged — still just the first line in the toast, nothing added to
   * the log.
   */
  function reportRefreshError(id: string | number, e: unknown, retry: () => void) {
    const message = e instanceof Error ? e.message : "Refresh failed";
    const firstLine = message.split("\n")[0];
    if (AUTH_ERROR.test(message)) {
      setLog((prev) => [...prev, ...message.split("\n")]);
      const loggedIn = authStatus?.basecamp || authStatus?.ti;
      if (loggedIn) {
        toast.error(
          "Your Toastmasters session has expired. Log out and log in again to continue.",
          {
            id,
            action: {
              label: "Log in again",
              onClick: () => {
                void (async () => {
                  if (await handleLogin()) retry();
                })();
              },
            },
          },
        );
      } else {
        toast.error("Log in to Toastmasters first, then Refresh.", { id });
      }
    } else {
      toast.error(firstLine, { id });
    }
  }

  async function handleRefreshProgress() {
    setLog([]);
    setConsoleCollapsed(false);
    setRefreshingProgress(true);
    const id = toast.loading("Fetching progress from Basecamp...");
    try {
      await refreshProgress();
      toast.success("Progress refreshed", { id });
      await loadMembers();
      await loadAuthStatus();
    } catch (e) {
      if (e instanceof IpcError && e.code === "CANCELLED") {
        toast.info("Refresh cancelled", { id });
      } else {
        reportRefreshError(id, e, () => void handleRefreshProgress());
      }
    } finally {
      setRefreshingProgress(false);
    }
  }

  async function handleRefreshMembership() {
    setLog([]);
    setConsoleCollapsed(false);
    setRefreshingMembership(true);
    const id = toast.loading("Downloading membership from TI...");
    try {
      await refreshMembership();
      toast.success("Membership refreshed", { id });
      await loadMembers();
      await loadAuthStatus();
    } catch (e) {
      if (e instanceof IpcError && e.code === "CANCELLED") {
        toast.info("Refresh cancelled", { id });
      } else {
        reportRefreshError(id, e, () => void handleRefreshMembership());
      }
    } finally {
      setRefreshingMembership(false);
    }
  }

  async function handleDownloadCsv() {
    try {
      const savedTo = await downloadMembershipCsv();
      if (savedTo) toast.success(`Saved to ${savedTo}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.split("\n")[0] : "Download failed");
    }
  }

  async function handleDownloadProgressCsv() {
    try {
      const savedTo = await downloadProgressCsv();
      if (savedTo) toast.success(`Saved to ${savedTo}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.split("\n")[0] : "Download failed");
    }
  }

  function renderBody() {
    if (error)
      return (
        <Card>
          <CardHeader>
            <CardTitle>Error loading data</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      );

    if (!members)
      return (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      );

    if (members.length === 0) {
      const loggedIn = authStatus?.basecamp || authStatus?.ti;
      return (
        <Card>
          <CardHeader>
            <CardTitle>No data yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {loggedIn
                ? "Use the refresh buttons above to fetch data."
                : "Log in to Toastmasters first, then use the refresh buttons above to fetch data."}
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <>
        <MemberTable members={members} onSelectMember={onSelectMember} />
        <div className="mt-6">
          <DiffSection loadDiff={getDiff} />
        </div>
      </>
    );
  }

  return (
    <main className="max-w-[960px] mx-auto py-8 px-4">
      <DashboardHeader
        memberCount={members?.length ?? null}
        latestSnapshotAt={latestSnapshotAt}
        refreshingProgress={refreshingProgress}
        refreshingMembership={refreshingMembership}
        onRefreshProgress={() => void handleRefreshProgress()}
        onRefreshMembership={() => void handleRefreshMembership()}
        authControl={
          <>
            <AuthStatusBadge status={authStatus} />
            {authStatus?.basecamp || authStatus?.ti ? (
              <Button variant="outline" size="sm" onClick={() => void handleLogout()}>
                <LogOut className="h-4 w-4" />
                Log out
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => void handleLogin()}>
                <LogIn className="h-4 w-4" />
                Log in
              </Button>
            )}
          </>
        }
        membershipCsvControl={
          <Button variant="outline" size="sm" onClick={() => void handleDownloadCsv()}>
            <Download className="h-4 w-4" />
            Membership CSV
          </Button>
        }
        progressCsvControl={
          <Button variant="outline" size="sm" onClick={() => void handleDownloadProgressCsv()}>
            <FileDown className="h-4 w-4" />
            Export Report
          </Button>
        }
        themeControl={<ThemeToggle />}
      />
      {renderBody()}
    </main>
  );
}

/**
 * A small badge next to the "Log in" button reflecting the current session
 * state, so the user isn't left guessing whether they're already logged in.
 */
function AuthStatusBadge({ status }: { status: AuthStatus | null }) {
  const label = describeAuthStatus(status);
  const variant =
    label === "Logged in" ? "default" : label === "Not logged in" ? "outline" : "secondary";

  return (
    <Badge variant={variant}>
      {label === "Logged in" ? (
        <CircleCheck className="h-3 w-3" />
      ) : (
        <CircleDashed className="h-3 w-3" />
      )}
      {label}
    </Badge>
  );
}
