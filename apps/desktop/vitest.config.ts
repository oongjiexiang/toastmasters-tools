import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    // tests/main-bundle.test.ts runs the real `electron-vite build` so it can
    // inspect the artifact that actually ships, rather than a stale out/ dir.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
