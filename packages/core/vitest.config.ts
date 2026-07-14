import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      include: ["helpers/pathway.ts", "helpers/db.ts"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 75,
        functions: 75,
      },
    },
  },
});
