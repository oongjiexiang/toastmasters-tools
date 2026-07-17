import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RefreshConsoleProps {
  lines: string[];
  active: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCancel: () => void;
}

/**
 * A live, auto-scrolling output panel for refresh progress. Shows the lines the
 * scrapers emit so the user can see the run advancing (and roughly how long it
 * will take) instead of staring at a spinner.
 *
 * Lifted up to `App.tsx` (Phase 22) so it survives navigation between the
 * dashboard and the member-detail view — it used to live inside
 * `DashboardView`, which unmounted (and lost the log) on every view switch.
 * Its own collapse toggle is intentionally separate state from
 * `ExpandCollapseToggle` (table rows / accordion levels) — an unrelated
 * concern that must not be wired to this console.
 */
export function RefreshConsole({
  lines,
  active,
  collapsed,
  onToggleCollapsed,
  onCancel,
}: RefreshConsoleProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view as the stream grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Logs copied to clipboard");
    } catch {
      toast.error("Could not copy logs to clipboard");
    }
  }

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
        <div className="ml-auto flex items-center gap-1">
          {active && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onCancel}>
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void handleCopy()}>
            <Copy className="h-3.5 w-3.5" />
            Copy logs
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label={collapsed ? "Expand console" : "Collapse console"}
            onClick={onToggleCollapsed}
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
      {!collapsed && (
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
      )}
    </div>
  );
}
