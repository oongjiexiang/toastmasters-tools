// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

/**
 * Repo-wide flat ESLint config (Phase 21).
 *
 * One config for every workspace (packages/core, packages/ui, apps/desktop) —
 * no per-workspace duplication.
 *
 * Two tiers of TypeScript linting:
 *   1. Type-aware (`recommendedTypeChecked` + a few extra correctness rules)
 *      for each workspace's real source, via `projectService`, which resolves
 *      each file against its workspace's own `tsconfig.json`.
 *   2. Plain, non-type-aware linting for everything else (tests, vitest/
 *      electron-vite configs, this file) — those files sit outside every
 *      workspace tsconfig's `include` on purpose (see the tsconfig.json
 *      comments), so `projectService` cannot resolve them. They still get
 *      the syntactic rule set, just not the type-checked one.
 *
 * `eslint-config-prettier` is last so it can disable any stylistic ESLint
 * rule that would otherwise fight Prettier's own formatting (`npm run
 * format`) — ESLint owns correctness, Prettier owns formatting.
 */

/** Each workspace's real (non-test) source — the files with type-aware linting. */
const TYPED_SOURCE_GLOBS = [
  "packages/core/**/*.ts",
  "packages/ui/**/*.{ts,tsx}",
  "apps/desktop/src/**/*.{ts,tsx}",
];

const TEST_GLOBS = ["**/tests/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/out/**",
      "**/release/**",
      "**/coverage/**",
      "**/dist/**",
      "apps/desktop/tests/fixtures/**",
      "results/**",
    ],
  },

  js.configs.recommended,

  // Tier 2: plain syntactic linting for every .ts/.tsx file (tests, configs,
  // scripts included). Overridden/augmented by the type-aware block below
  // for real source.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Tier 1: type-aware linting for each workspace's real source.
  {
    files: TYPED_SOURCE_GLOBS,
    ignores: TEST_GLOBS,
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // Real bugs, not style — the two categories the roadmap calls out by name.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // The IPC dispatch tables (apps/desktop/src/main/index.ts) and core's
      // ProgressReporter-driven services intentionally implement a
      // `Promise<T>`-returning interface with handlers that are sometimes
      // synchronous under the hood — that's a deliberate interface shape,
      // not a bug.
      "@typescript-eslint/require-await": "off",
    },
  },

  // Renderer (React) code: packages/ui and the desktop renderer.
  {
    files: ["packages/ui/**/*.{ts,tsx}", "apps/desktop/src/renderer/**/*.{ts,tsx}"],
    ignores: TEST_GLOBS,
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // Deliberately just the two classic hook-correctness rules, not the
      // full `recommended` set — eslint-plugin-react-hooks v7 bundles a much
      // larger "React Compiler readiness" ruleset (immutability, purity,
      // set-state-in-effect/render, etc.) that would flag this codebase's
      // long-standing, working "fetch on mount" effects. Adopting the
      // compiler ruleset is a real, separate piece of work, not a
      // behaviour-preserving cleanup — out of scope for this phase.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Test files are owned by the tester agent, not this developer pass — keep
  // syntactic linting (Tier 2, above) but don't fail the build over an unused
  // fixture/helper that's legitimately the tester's call to prune.
  {
    files: TEST_GLOBS,
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  eslintConfigPrettier,
);
