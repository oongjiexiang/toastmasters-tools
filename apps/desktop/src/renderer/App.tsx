import { useEffect, useState } from "react";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { RefreshConsole } from "./components/RefreshConsole";
import { DashboardView } from "./views/DashboardView";
import { MemberDetailView } from "./views/MemberDetailView";
import { cancelRefresh, getAppVersion, onRefreshLog } from "./lib/api";

/**
 * The desktop app has two screens, so it holds a view union in state rather than
 * pulling in a router. This was the Electron counterpart of the old Next.js web
 * app's `app/page.tsx` + `app/members/[email]/page.tsx` route pair (removed in
 * Phase 14) — the components inside each screen are the same ones from
 * `packages/ui` that the web app used to render.
 */
type View = { name: "dashboard" } | { name: "member"; email: string; pathway: string };

export function App() {
  const [view, setView] = useState<View>({ name: "dashboard" });

  // Lifted up from DashboardView (Phase 22) so the refresh console — and its
  // contents — survives navigating to the member-detail view and back, rather
  // than being unmounted along with DashboardView.
  const [log, setLog] = useState<string[]>([]);
  const [refreshingProgress, setRefreshingProgress] = useState(false);
  const [refreshingMembership, setRefreshingMembership] = useState(false);
  // Collapsed by default when idle (Phase 25, item 3) — a console that's
  // mostly empty history shouldn't demand attention on every launch. Forced
  // open via `setConsoleCollapsed(false)` when a refresh starts (see
  // `DashboardView.tsx`'s `handleRefreshProgress`/`handleRefreshMembership`);
  // otherwise left at whatever the user last toggled.
  const [consoleCollapsed, setConsoleCollapsed] = useState(true);
  // Phase 31: read once from the packaged app itself (never hand-typed), so a
  // bug report can name a build. null until the IPC round-trip resolves.
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const refreshing = refreshingProgress || refreshingMembership;

  // Subscribe once to the live progress stream; append each line to the console.
  useEffect(() => {
    const unsubscribe = onRefreshLog((line) => setLog((prev) => [...prev, line]));
    return unsubscribe;
  }, []);

  // Fetches once on mount and also updates the OS window title/taskbar entry —
  // Electron syncs BrowserWindow's title to document.title automatically, and
  // nothing in main/index.ts prevents that default. Applies regardless of
  // which view is showing (dashboard or member-detail); the title does not
  // change per-screen.
  useEffect(() => {
    let cancelled = false;
    void getAppVersion()
      .then((version) => {
        if (cancelled) return;
        setAppVersion(version);
        document.title = `Toastmasters Dashboard v${version}`;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Providers>
      {view.name === "dashboard" ? (
        <DashboardView
          onSelectMember={(email, pathway) => setView({ name: "member", email, pathway })}
          setLog={setLog}
          refreshingProgress={refreshingProgress}
          setRefreshingProgress={setRefreshingProgress}
          refreshingMembership={refreshingMembership}
          setRefreshingMembership={setRefreshingMembership}
          setConsoleCollapsed={setConsoleCollapsed}
          appVersion={appVersion}
        />
      ) : (
        <MemberDetailView
          email={view.email}
          pathway={view.pathway}
          onBack={() => setView({ name: "dashboard" })}
        />
      )}
      {/* Below the header/title in DOM order (Phase 25, item 3) — rendered here,
          as a sibling of the two views, so it keeps surviving navigation between
          them (Phase 22) instead of being remounted along with DashboardView. */}
      {(log.length > 0 || refreshing) && (
        <div className="max-w-[960px] mx-auto px-4 pb-8">
          <RefreshConsole
            lines={log}
            active={refreshing}
            collapsed={consoleCollapsed}
            onToggleCollapsed={() => setConsoleCollapsed((prev) => !prev)}
            onCancel={() => void cancelRefresh().catch(() => {})}
          />
        </div>
      )}
      <Toaster />
    </Providers>
  );
}
