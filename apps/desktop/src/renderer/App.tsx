import { useEffect, useState } from "react";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { RefreshConsole } from "./components/RefreshConsole";
import { DashboardView } from "./views/DashboardView";
import { MemberDetailView } from "./views/MemberDetailView";
import { cancelRefresh, onRefreshLog } from "./lib/api";

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
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);

  const refreshing = refreshingProgress || refreshingMembership;

  // Subscribe once to the live progress stream; append each line to the console.
  useEffect(() => {
    const unsubscribe = onRefreshLog((line) => setLog((prev) => [...prev, line]));
    return unsubscribe;
  }, []);

  return (
    <Providers>
      {(log.length > 0 || refreshing) && (
        <div className="max-w-[960px] mx-auto px-4 pt-8">
          <RefreshConsole
            lines={log}
            active={refreshing}
            collapsed={consoleCollapsed}
            onToggleCollapsed={() => setConsoleCollapsed((prev) => !prev)}
            onCancel={() => void cancelRefresh().catch(() => {})}
          />
        </div>
      )}
      {view.name === "dashboard" ? (
        <DashboardView
          onSelectMember={(email, pathway) => setView({ name: "member", email, pathway })}
          setLog={setLog}
          refreshingProgress={refreshingProgress}
          setRefreshingProgress={setRefreshingProgress}
          refreshingMembership={refreshingMembership}
          setRefreshingMembership={setRefreshingMembership}
          setConsoleCollapsed={setConsoleCollapsed}
        />
      ) : (
        <MemberDetailView
          email={view.email}
          pathway={view.pathway}
          onBack={() => setView({ name: "dashboard" })}
        />
      )}
      <Toaster />
    </Providers>
  );
}
