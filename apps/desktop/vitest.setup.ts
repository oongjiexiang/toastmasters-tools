// Vitest `setupFiles` entry (registered in vitest.config.ts). Runs for every
// test file, including the existing `environment: "node"` main-process tests
// in `tests/*.test.ts` — the jest-dom matchers and RTL cleanup below are
// harmless (no-ops) without a DOM, so this does not affect them.
//
// Phase 19: component tests (jsdom-per-file via a `// @vitest-environment
// jsdom` docblock) need `@testing-library/jest-dom`'s matchers, RTL's
// `cleanup()` between tests, and a `window.matchMedia` polyfill, since
// `next-themes`' `useTheme()` (with `enableSystem`) calls `matchMedia` and
// jsdom does not implement it.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
