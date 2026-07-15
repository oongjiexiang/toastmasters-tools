import { useState } from "react";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { DashboardView } from "./views/DashboardView";
import { MemberDetailView } from "./views/MemberDetailView";

/**
 * The desktop app has two screens, so it holds a view union in state rather than
 * pulling in a router. This is the Electron counterpart of the web app's
 * `app/page.tsx` + `app/members/[email]/page.tsx` route pair — the components
 * inside each screen are the same ones the web app renders.
 */
type View =
  | { name: "dashboard" }
  | { name: "member"; email: string; pathway: string };

export function App() {
  const [view, setView] = useState<View>({ name: "dashboard" });

  return (
    <Providers>
      {view.name === "dashboard" ? (
        <DashboardView
          onSelectMember={(email, pathway) =>
            setView({ name: "member", email, pathway })
          }
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
