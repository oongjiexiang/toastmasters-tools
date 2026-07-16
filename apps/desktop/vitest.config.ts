import { resolve } from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Mirrors the renderer alias in electron.vite.config.ts: packages/ui's
// components import through a Next-style "@/*" alias that resolves to the
// package root, not to apps/desktop. Component tests render those
// components directly, so the same alias must exist here or every import
// of "@/components/ui/*" inside packages/ui fails to resolve under Vitest.
const UI_DIR = resolve(__dirname, "../../packages/ui");

export default defineConfig({
  // The `react()` plugin is what actually transforms JSX in .tsx files to
  // use the automatic jsx-runtime (`tsconfig.json`'s `"jsx": "react-jsx"`
  // alone does nothing under Vitest/esbuild without this) — omitting it
  // produces a "React is not defined" ReferenceError at render time.
  plugins: [react()],
  resolve: {
    alias: {
      "@": UI_DIR,
    },
  },
  test: {
    // The global environment stays "node" — all existing tests are
    // main-process/pure-function tests with no DOM. Phase 19 component tests
    // opt into jsdom per-file via a `// @vitest-environment jsdom` docblock
    // (Vitest's supported per-file override) rather than flipping this.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    // tests/main-bundle.test.ts runs the real `electron-vite build` so it can
    // inspect the artifact that actually ships, rather than a stale out/ dir.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
