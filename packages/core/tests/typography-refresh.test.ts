import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Phase 30 structural invariant: the dashboard typography refresh
 * (see specs/roadmap.md "## Phase 30").
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
 * pre-Phase-30 content.
 *
 * Per the roadmap's explicit "sizes stay put" constraint, this test also
 * pins that none of the three heading sites lost or changed their
 * `text-2xl`/`text-base` size class — only `tracking-tight` should have been
 * added alongside it.
 *
 * PR #16 review follow-up: the original version of this test pinned the
 * `--font-sans` declaration and the `CardTitle` className with
 * whitespace-literal / full-string regexes, so a routine reformat (Prettier
 * re-wrapping the CSS value, an unrelated future `CardTitle` class tweak)
 * would fail the suite even with the targeted property unchanged. The
 * assertions below instead extract just the relevant value first and check
 * it whitespace-normalized / by token membership, so the guard only fires
 * when the font stack's actual composition or the `tracking-tight` token
 * itself regresses. The `"Inter"` stack entry was also dropped (a second
 * review finding): it was never reachable in practice since this app bundles
 * no font files and Inter isn't a stock system font on Windows/macOS.
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
const EXPECTED_FONT_SANS_VALUE =
  '"Segoe UI Variable", -apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, sans-serif';

/** Extracts the `--font-sans` custom property's value, whitespace-collapsed. */
function extractFontSansValue(css: string): string {
  const value = css.match(/--font-sans:\s*([^;]+);/)?.[1];
  if (value === undefined) {
    throw new Error("no --font-sans declaration found");
  }
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The contract, applied to the real `globals.css` contents (must hold) and,
 * by the negative-control test below, to a fixture string reproducing the
 * exact pre-Phase-30 file (must NOT hold). Whitespace-insensitive so a
 * reformat of the declaration's line-wrapping doesn't break this guard.
 */
function assertFontStackShipped(css: string): void {
  expect(css).not.toContain(OLD_SELF_REFERENTIAL_FONT_SANS);
  expect(extractFontSansValue(css)).toBe(EXPECTED_FONT_SANS_VALUE);
  // `antialiased` added alongside the existing `font-sans` on the `html` rule.
  expect(css.replace(/\s+/g, " ")).toMatch(/html\s*\{\s*@apply font-sans antialiased;\s*\}/);
}

/**
 * Extracts a heading `<h1>`'s `className` value, tolerating either a literal
 * `className="..."` or a `className={cn("...")}` form so a future refactor
 * to `cn(...)` doesn't itself break this test.
 */
function extractH1ClassName(source: string): string {
  const literal = source.match(/<h1\s+className="([^"]+)">/)?.[1];
  if (literal !== undefined) {
    return literal;
  }
  const wrapped = source.match(/<h1\s+className=\{cn\(\s*"([^"]+)"/)?.[1];
  if (wrapped !== undefined) {
    return wrapped;
  }
  throw new Error("h1 className not found in either literal or cn(...) form");
}

/** Extracts the `CardTitle` component's base (first) `cn(...)` class string. */
function extractCardTitleBaseClassName(source: string): string {
  const value = source.match(/function CardTitle\([\s\S]*?cn\(\s*"([^"]+)"/)?.[1];
  if (value === undefined) {
    throw new Error("CardTitle base className not found");
  }
  return value;
}

/** Asserts every token in `required` is present in the space-separated `className`, regardless of order or unrelated classes. */
function assertClassTokensPresent(className: string, required: string[]): void {
  const tokens = new Set(className.trim().split(/\s+/).filter(Boolean));
  for (const token of required) {
    expect(tokens.has(token)).toBe(true);
  }
}

describe("packages/ui/globals.css font stack (Phase 30)", () => {
  const css = readFileSync(GLOBALS_CSS_PATH, "utf8");

  it("ships the explicit offline-safe font stack, not the old self-referential no-op", () => {
    assertFontStackShipped(css);
  });

  it("does not carry the unreachable 'Inter' fallback (PR #16 review finding)", () => {
    expect(extractFontSansValue(css)).not.toContain("Inter");
  });
});

describe("negative control: the pre-Phase-30 globals.css shape is rejected", () => {
  // Reproduces the exact pre-Phase-30 @theme inline block: the
  // self-referential `--font-sans: var(--font-sans)` no-op, and `html`
  // applying only `font-sans` (no `antialiased`).
  const preP30Css = `
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
    expect(() => assertFontStackShipped(preP30Css)).toThrow();
  });

  it("fails because `html` doesn't yet apply `antialiased`", () => {
    const cssWithNewFontButNoAntialiased = preP30Css.replace(
      OLD_SELF_REFERENTIAL_FONT_SANS,
      `--font-sans: ${EXPECTED_FONT_SANS_VALUE};`,
    );
    expect(() => assertFontStackShipped(cssWithNewFontButNoAntialiased)).toThrow();
  });

  it("is not fooled by reformatting: a re-wrapped but equivalent declaration still passes", () => {
    const reformatted = preP30Css
      .replace(
        OLD_SELF_REFERENTIAL_FONT_SANS,
        '--font-sans:\n    "Segoe UI Variable", -apple-system,\n    BlinkMacSystemFont, ui-sans-serif, system-ui, sans-serif;',
      )
      .replace("@apply font-sans;", "@apply   font-sans antialiased;");
    expect(() => assertFontStackShipped(reformatted)).not.toThrow();
  });
});

describe("heading tracking-tight (Phase 30)", () => {
  it("DashboardHeader's <h1> keeps text-2xl and gains tracking-tight", () => {
    const className = extractH1ClassName(readFileSync(DASHBOARD_HEADER_PATH, "utf8"));
    assertClassTokensPresent(className, ["text-2xl", "font-semibold", "tracking-tight"]);
  });

  it("MemberDetailView's <h1> keeps text-2xl and gains tracking-tight", () => {
    const className = extractH1ClassName(readFileSync(MEMBER_DETAIL_VIEW_PATH, "utf8"));
    assertClassTokensPresent(className, ["text-2xl", "font-semibold", "tracking-tight"]);
  });

  it("CardTitle keeps text-base and gains tracking-tight, without pinning unrelated classes", () => {
    const className = extractCardTitleBaseClassName(readFileSync(CARD_PATH, "utf8"));
    assertClassTokensPresent(className, ["text-base", "tracking-tight"]);
  });

  it("CardTitle's size=sm variant resets tracking to normal (PR #16 review finding: tight tracking must not apply at body-text size)", () => {
    const source = readFileSync(CARD_PATH, "utf8");
    const cardTitleBlock = source.match(/function CardTitle\([\s\S]*?\n\}/);
    expect(cardTitleBlock).not.toBeNull();
    expect(cardTitleBlock![0]).toContain("group-data-[size=sm]/card:tracking-normal");
  });
});

describe("negative control: pre-Phase-30 heading sites are rejected", () => {
  // Reproduces the exact pre-Phase-30 heading markup: same size classes,
  // no tracking-tight.
  const preP30DashboardHeaderSource =
    '<h1 className="text-2xl font-semibold">Toastmasters Dashboard</h1>';
  const preP30MemberDetailViewSource = '<h1 className="text-2xl font-semibold">{detail.name}</h1>';
  const preP30CardTitleSource =
    'function CardTitle({ className, ...props }: React.ComponentProps<"div">) {\n' +
    '  return (\n' +
    '    <div\n' +
    '      data-slot="card-title"\n' +
    '      className={cn(\n' +
    '        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",\n' +
    "        className,\n" +
    "      )}\n" +
    "}";

  it("fails for DashboardHeader's pre-Phase-30 <h1> (no tracking-tight)", () => {
    const className = extractH1ClassName(preP30DashboardHeaderSource);
    expect(() =>
      assertClassTokensPresent(className, ["text-2xl", "font-semibold", "tracking-tight"]),
    ).toThrow();
  });

  it("fails for MemberDetailView's pre-Phase-30 <h1> (no tracking-tight)", () => {
    const className = extractH1ClassName(preP30MemberDetailViewSource);
    expect(() =>
      assertClassTokensPresent(className, ["text-2xl", "font-semibold", "tracking-tight"]),
    ).toThrow();
  });

  it("fails for CardTitle's pre-Phase-30 className (no tracking-tight)", () => {
    const className = extractCardTitleBaseClassName(preP30CardTitleSource);
    expect(() => assertClassTokensPresent(className, ["text-base", "tracking-tight"])).toThrow();
  });

  it("still finds the size classes present in the pre-Phase-30 fixtures (proves these aren't just any old string)", () => {
    expect(preP30DashboardHeaderSource).toContain("text-2xl font-semibold");
    expect(preP30MemberDetailViewSource).toContain("text-2xl font-semibold");
    expect(extractCardTitleBaseClassName(preP30CardTitleSource)).toContain(
      "text-base leading-snug font-medium",
    );
  });

  it("is not vacuous: a className with tracking-tight elsewhere in the string but not as its own token still passes token check correctly", () => {
    // Guards against a substring-match bug (e.g. "tracking-tightly" or a
    // class named "not-tracking-tight") slipping past the token-set check.
    const trickySource = '<h1 className="text-2xl font-semibold tracking-tightly">Oops</h1>';
    const className = extractH1ClassName(trickySource);
    expect(() =>
      assertClassTokensPresent(className, ["text-2xl", "font-semibold", "tracking-tight"]),
    ).toThrow();
  });
});
