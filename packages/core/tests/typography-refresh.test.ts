import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Phase 29 structural invariant: the dashboard typography refresh
 * (see specs/roadmap.md "## Phase 29").
 *
 * Before this phase, `packages/ui/globals.css` set
 * `--font-sans: var(--font-sans)` — a self-referential no-op that just fell
 * through to Tailwind/shadcn's generic default sans stack — and none of
 * `DashboardHeader`'s `<h1>`, `MemberDetailView`'s `<h1>`, or the shared
 * `CardTitle` primitive carried any letter-spacing utility. Neither change
 * is asserted on by any existing test (confirmed by grepping the tests
 * directories of every workspace package for "font-family", "font-sans",
 * and "tracking-" before this test was added) — a future edit could silently
 * revert the font stack to the no-op, or drop `tracking-tight` from a
 * heading, with a fully green `npm test` run.
 *
 * This mirrors the structural-guard pattern established by
 * `ci-workflow.test.ts` and `electron-version.test.ts`: assert the shipped
 * shape on the real files, then prove the assertions aren't vacuously true
 * by running them against fixture strings that reproduce the exact
 * pre-Phase-29 content.
 *
 * Per the roadmap's explicit "sizes stay put" constraint, this test also
 * pins that none of the three heading sites lost or changed their
 * `text-2xl`/`text-base` size class — only `tracking-tight` should have been
 * added alongside it.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(CORE_DIR, "../..");

const GLOBALS_CSS_PATH = join(REPO_ROOT, "packages", "ui", "globals.css");
const DASHBOARD_HEADER_PATH = join(
  REPO_ROOT,
  "packages",
  "ui",
  "components",
  "DashboardHeader.tsx",
);
const MEMBER_DETAIL_VIEW_PATH = join(
  REPO_ROOT,
  "apps",
  "desktop",
  "src",
  "renderer",
  "views",
  "MemberDetailView.tsx",
);
const CARD_PATH = join(REPO_ROOT, "packages", "ui", "components", "ui", "card.tsx");

const OLD_SELF_REFERENTIAL_FONT_SANS = "--font-sans: var(--font-sans);";
const NEW_FONT_STACK_MARKER = '"Segoe UI Variable"';

/**
 * The contract, applied to the real `globals.css` contents (must hold) and,
 * by the negative-control test below, to a fixture string reproducing the
 * exact pre-Phase-29 file (must NOT hold).
 */
function assertFontStackShipped(css: string): void {
  expect(css).not.toContain(OLD_SELF_REFERENTIAL_FONT_SANS);
  expect(css).toContain(NEW_FONT_STACK_MARKER);
  // The full offline-safe stack, in order: Windows 11 first (this app's
  // primary platform), then macOS, then Inter, then generic fallbacks.
  expect(css).toMatch(
    /--font-sans:\s*\n?\s*"Segoe UI Variable",\s*-apple-system,\s*BlinkMacSystemFont,\s*"Inter",\s*ui-sans-serif,\s*system-ui,\s*sans-serif;/,
  );
  // `antialiased` added alongside the existing `font-sans` on the `html` rule.
  expect(css).toMatch(/html\s*\{\s*@apply font-sans antialiased;\s*\}/);
}

/**
 * The contract for a heading site: the size class is unchanged and
 * `tracking-tight` was added alongside it (not replacing it).
 */
function assertHeadingHasTrackingTight(source: string, headingSnippet: RegExp): void {
  const match = source.match(headingSnippet);
  expect(match).not.toBeNull();
}

describe("packages/ui/globals.css font stack (Phase 29)", () => {
  const css = readFileSync(GLOBALS_CSS_PATH, "utf8");

  it("ships the explicit offline-safe font stack, not the old self-referential no-op", () => {
    assertFontStackShipped(css);
  });
});

describe("negative control: the pre-Phase-29 globals.css shape is rejected", () => {
  // Reproduces the exact pre-Phase-29 @theme inline block: the
  // self-referential `--font-sans: var(--font-sans)` no-op, and `html`
  // applying only `font-sans` (no `antialiased`).
  const preP29Css = `
@theme inline {
  --font-heading: var(--font-sans);
  --font-sans: var(--font-sans);
  --color-ring: var(--ring);
}

@layer base {
  html {
    @apply font-sans;
  }
}
`;

  it("fails because the font stack is still the self-referential no-op", () => {
    expect(() => assertFontStackShipped(preP29Css)).toThrow();
  });

  it("is not vacuously true: the fixture really lacks the new stack marker", () => {
    expect(preP29Css).not.toContain(NEW_FONT_STACK_MARKER);
  });

  it("fails because `html` doesn't yet apply `antialiased`", () => {
    const cssWithNewFontButNoAntialiased = preP29Css.replace(
      OLD_SELF_REFERENTIAL_FONT_SANS,
      '--font-sans:\n    "Segoe UI Variable", -apple-system, BlinkMacSystemFont, "Inter", ui-sans-serif, system-ui,\n    sans-serif;',
    );
    expect(() => assertFontStackShipped(cssWithNewFontButNoAntialiased)).toThrow();
  });
});

describe("heading tracking-tight (Phase 29)", () => {
  it("DashboardHeader's <h1> keeps text-2xl and gains tracking-tight", () => {
    const source = readFileSync(DASHBOARD_HEADER_PATH, "utf8");
    assertHeadingHasTrackingTight(
      source,
      /<h1 className="text-2xl font-semibold tracking-tight">/,
    );
  });

  it("MemberDetailView's <h1> keeps text-2xl and gains tracking-tight", () => {
    const source = readFileSync(MEMBER_DETAIL_VIEW_PATH, "utf8");
    assertHeadingHasTrackingTight(
      source,
      /<h1 className="text-2xl font-semibold tracking-tight">/,
    );
  });

  it("CardTitle keeps text-base and gains tracking-tight", () => {
    const source = readFileSync(CARD_PATH, "utf8");
    assertHeadingHasTrackingTight(
      source,
      /"font-heading text-base leading-snug font-medium tracking-tight group-data-\[size=sm\]\/card:text-sm"/,
    );
  });
});

describe("negative control: pre-Phase-29 heading sites are rejected", () => {
  // Reproduces the exact pre-Phase-29 heading markup: same size classes,
  // no tracking-tight.
  const preP29DashboardHeaderSource = '<h1 className="text-2xl font-semibold">Toastmasters Dashboard</h1>';
  const preP29MemberDetailViewSource = '<h1 className="text-2xl font-semibold">{detail.name}</h1>';
  const preP29CardTitleSource =
    '"font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm"';

  it("fails for DashboardHeader's pre-Phase-29 <h1> (no tracking-tight)", () => {
    expect(() =>
      assertHeadingHasTrackingTight(
        preP29DashboardHeaderSource,
        /<h1 className="text-2xl font-semibold tracking-tight">/,
      ),
    ).toThrow();
  });

  it("fails for MemberDetailView's pre-Phase-29 <h1> (no tracking-tight)", () => {
    expect(() =>
      assertHeadingHasTrackingTight(
        preP29MemberDetailViewSource,
        /<h1 className="text-2xl font-semibold tracking-tight">/,
      ),
    ).toThrow();
  });

  it("fails for CardTitle's pre-Phase-29 className (no tracking-tight)", () => {
    expect(() =>
      assertHeadingHasTrackingTight(
        preP29CardTitleSource,
        /"font-heading text-base leading-snug font-medium tracking-tight group-data-\[size=sm\]\/card:text-sm"/,
      ),
    ).toThrow();
  });

  it("still finds the size classes present in the pre-Phase-29 fixtures (proves these aren't just any old string)", () => {
    expect(preP29DashboardHeaderSource).toContain("text-2xl font-semibold");
    expect(preP29MemberDetailViewSource).toContain("text-2xl font-semibold");
    expect(preP29CardTitleSource).toContain("text-base leading-snug font-medium");
  });
});
