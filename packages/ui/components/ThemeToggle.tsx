"use client";

import { Moon, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const CYCLE = ["light", "dark", "system"] as const;
type ThemeChoice = (typeof CYCLE)[number];

const ICONS: Record<ThemeChoice, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: SunMoon,
};

const LABELS: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * Header control cycling light -> dark -> system (Phase 19, item 6). Reads
 * and writes via `next-themes`' `useTheme()`, which persists the choice to
 * `localStorage` (see `Providers`/`ThemeProvider` in `providers.tsx`).
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current: ThemeChoice = CYCLE.includes(theme as ThemeChoice)
    ? (theme as ThemeChoice)
    : "system";
  const Icon = ICONS[current];

  function cycle() {
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    setTheme(next);
  }

  return (
    <Button
      variant="outline"
      size="icon-sm"
      onClick={cycle}
      aria-label={`Theme: ${LABELS[current]} (click to change)`}
      title={`Theme: ${LABELS[current]}`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
