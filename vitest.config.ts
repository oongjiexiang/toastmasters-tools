import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run in Node environment — this project is a CLI/server tool with no browser context
    environment: "node",
    // Discover tests under tests/ directory
    include: ["tests/**/*.test.ts"],
    // Provide clean globals (describe, it, expect) without import in every file
    globals: true,
    // Coverage config (used by npm run test:coverage)
    coverage: {
      provider: "v8",
      include: ["helpers/**/*.ts", "services/**/*.ts"],
      exclude: ["helpers/db.ts"], // db.ts uses file I/O defaults; covered by tests with :memory:
      reporter: ["text", "html"],
      thresholds: {
        lines: 80,
        functions: 80,
      },
    },
  },
});
