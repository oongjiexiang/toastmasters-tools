import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      // helpers/pathway.ts (target 90%+) and API route mappers (smoke coverage)
      include: ["helpers/pathway.ts", "app/api/**/*.ts"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 75,
        functions: 75,
      },
    },
  },
});
