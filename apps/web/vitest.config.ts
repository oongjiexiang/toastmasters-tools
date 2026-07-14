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
    include: ["tests/api/**/*.test.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      include: ["app/api/**/*.ts"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 75,
        functions: 75,
      },
    },
  },
});
