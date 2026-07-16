import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CircleCheck, CircleDashed, Download, LogIn, LogOut } from "lucide-react";
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
  getAuthStatus,
  getDiff,
  getMembers,
  IpcError,
  logIn,
  logOut,
  onRefreshLog,
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
}

export function DashboardView({ onSelectMember }: DashboardViewProps) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshingProgress, setRefreshingProgress] = useState(false);
  const [refreshingMembership, setRefreshingMembership] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  const refreshing = refreshingProgress || refreshingMembership;

  // Subscribe once to the live progress stream; append each line to the console.
  useEffect(() => {
    const unsubscribe = onRefreshLog((line) => setLog((prev) => [...prev, line]));
    return unsubscribe;
  }, []);

  /**
   * Loads the member table. An empty database (SNAPSHOT_MISSING) is not an error
   * here — it renders the friendly "No data yet" card, which tells the user to
   * refresh. Only genuine failures set `error`.
   */
  async function loadMembers() {
    try {
      setMembers(await getMembers());
      setError(null);
    } catch (e) {
      if (e instanceof IpcError && e.code === "SNAPSHOT_MISSING") {
        setMembers([]);
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
        toast.success(
          "Signed in to Toastmasters — now use the Refresh buttons to load data",
          { id },
        );
        await loadMembers();
        await loadAuthStatus();
        return true;
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
   * Reports a failed refresh. An auth-shaped failure (HTTP 401/403) means the
   * session expired, so the toast offers a "Log in again" action that logs in and
   * retries the same refresh.
   */
  function reportRefreshError(id: string | number, e: unknown, retry: () => void) {
    const message = e instanceof Error ? e.message : "Refresh failed";
    const firstLine = message.split("\n")[0];
    if (AUTH_ERROR.test(message)) {
      toast.error(firstLine, {
        id,
        action: {
          label: "Log in again",
          onClick: async () => {
            if (await handleLogin()) retry();
          },
        },
      });
    } else {
      toast.error(firstLine, { id });
    }
  }

  async function handleRefreshProgress() {
    setLog([]);
    setRefreshingProgress(true);
    const id = toast.loading("Fetching progress from Basecamp...");
    try {
      await refreshProgress();
      toast.success("Progress refreshed", { id });
      await loadMembers();
      await loadAuthStatus();
    } catch (e) {
      reportRefreshError(id, e, () => void handleRefreshProgress());
    } finally {
      setRefreshingProgress(false);
    }
  }

  async function handleRefreshMembership() {
    setLog([]);
    setRefreshingMembership(true);
    const id = toast.loading("Downloading membership from TI...");
    try {
      await refreshMembership();
      toast.success("Membership refreshed", { id });
      await loadMembers();
      await loadAuthStatus();
    } catch (e) {
      reportRefreshError(id, e, () => void handleRefreshMembership());
    } finally {
      setRefreshingMembership(false);
    }
  }

  async function handleDownloadCsv() {
    try {
      const savedTo = await downloadMembershipCsv();
      if (savedTo) toast.success(`Saved to ${savedTo}`);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message.split("\n")[0] : "Download failed",
      );
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

    if (members.length === 0)
      return (
        <Card>
          <CardHeader>
            <CardTitle>No data yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Use the refresh buttons above to fetch data.
            </p>
          </CardContent>
        </Card>
      );

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
        refreshingProgress={refreshingProgress}
        refreshingMembership={refreshingMembership}
        onRefreshProgress={handleRefreshProgress}
        onRefreshMembership={handleRefreshMembership}
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
          <Button variant="outline" size="sm" onClick={handleDownloadCsv}>
            <Download className="h-4 w-4" />
            Membership CSV
          </Button>
        }
        themeControl={<ThemeToggle />}
      />
      {(refreshing || log.length > 0) && (
        <RefreshConsole lines={log} active={refreshing} />
      )}
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
    label === "Logged in"
      ? "default"
      : label === "Not logged in"
        ? "outline"
        : "secondary";

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

/**
 * A live, auto-scrolling output panel for refresh progress. Shows the lines the
 * scrapers emit so the user can see the run advancing (and roughly how long it
 * will take) instead of staring at a spinner.
 */
function RefreshConsole({ lines, active }: { lines: string[]; active: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view as the stream grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  return (
    <div className="mb-6 rounded-md border bg-muted/40">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span
          className={
            "h-2 w-2 rounded-full " +
            (active ? "bg-green-500 dark:bg-green-400 animate-pulse" : "bg-muted-foreground/40")
          }
          aria-hidden
        />
        <span className="text-xs font-medium text-muted-foreground">
          {active ? "Refreshing…" : "Last refresh"}
        </span>
      </div>
      <div className="max-h-56 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-muted-foreground">Starting…</p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap text-foreground/80">
              {line}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
