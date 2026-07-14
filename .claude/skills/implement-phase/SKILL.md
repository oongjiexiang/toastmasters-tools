---
name: implement-phase
description: 'Implement the next phase from specs/roadmap.md end-to-end using the developer → tester → linter → docs agent pipeline, with the product-manager agent resolving any product/business ambiguity. Use when: "implement the next phase", "build the next phase", "do Phase N", "implement the roadmap", or any request to ship a roadmap phase. Runs the phase''s own Validation criteria, verifies results independently, and stops for approval before committing.'
argument-hint: 'Optional: phase number (defaults to the next unfinished phase in specs/roadmap.md)'
---

# Implement a Roadmap Phase

Ships one phase from `specs/roadmap.md` through a fixed agent pipeline. The phases are ordered so each delivers value on its own; implement exactly one unless told otherwise.

## Where the specs live

This repo keeps architecture in **`specs/`**, not `docs/architecture/`:

- `specs/roadmap.md` — the phases, each with a **Validation** block. This is the contract.
- `specs/tech-stack.md` — layers, stack decisions, and Constraints.
- `specs/mission.md` — who the user is and what is explicitly out of scope.
- `specs/architecture-react.md`, `specs/feature-*.md` — **historical ADRs. Do not retcon them.**

Some agent definitions point at `docs/architecture/…`, which does not exist. Redirect them to `specs/` in the brief.

## The pipeline

Run these **sequentially** — each stage's output is the next one's input, and they touch the same files. Never run developer and tester concurrently.

1. **Discovery (you, before dispatching anything).** Do not delegate this. Read the phase, then map the blast radius yourself: the dependency closure of files being moved/changed, every consumer, every import alias, and the config files (`tsconfig`, `vitest.config`, `playwright.config`, `package.json`) that encode paths. Feed the findings into the briefs. A cold agent that re-derives this wastes a full context and gets it partly wrong.
2. **`developer`** — implements. Must leave `build` and `test` green.
3. **`tester`** — writes/audits tests. Not just "add tests": have it *attack* the developer's work.
4. **`linter`** — fixes lint/dead code, then runs the phase's **full** Validation block, including E2E.
5. **`docs`** — updates `README.md`, ticks the phase to Done in `specs/roadmap.md`, updates `specs/tech-stack.md`.
6. **`product-manager`** — only when there is genuine **product or business** ambiguity (see below). Advisory: tell it explicitly not to edit files.

## Rules that earn their keep

These are not ceremony. Each one caught a real defect in a past run.

**Verify agent claims yourself.** Agents self-report success. Before reporting a phase done, personally re-run the build, the tests, and the phase's Validation criteria. Independently confirm any load-bearing factual claim an agent makes before you act on it — especially before deleting anything.

**A green suite is not a working system.** Tests that inject an explicit dependency (a `dbPath`, a mock, a fixture) cannot see how the real thing resolves at runtime, and `tsc`/`build` cannot observe runtime behaviour like `process.cwd()`. After a structural change, ask: *what would still be broken with everything green?* Then check that thing by running it. A Phase 10 restructure silently repointed the CLI and dashboard at different databases with 178 tests passing.

**Demand negative controls.** A test that cannot fail is worth nothing. Require the tester to prove each new guard **fails against the old/broken behaviour**, and to prove mocks are actually engaged (a `vi.mock` whose specifier does not exactly match the module's import silently does nothing and the test hits real code). Ask for the negative-control output, not an assurance.

**Never let an agent edit a test assertion to make something pass.** State this in every brief. If an assertion genuinely must change because the contract changed, that is the **tester's** call, made explicitly and justified — not a developer quietly loosening a check to go green.

**The docs agent is a cross-check, not a formality.** It reads the code against the docs' claims and is the stage most likely to catch a lie. Do not skip or rush it. In the Phase 10 run it — not the 178 tests, not the linter — found the cwd bug that would have orphaned the user's real data.

**Respect agent boundaries, and expect handoffs.** Developers own `src/`, testers own tests, linters own style/dead code. When a developer refuses to touch a test assertion, that is correct behaviour — route it to the tester rather than overriding it.

## When to call the product-manager

Only for genuine **product/business** questions — not architecture. "Which monorepo layout" is technical: decide it. These are product:

- A written constraint now conflicts with the user's stated direction.
- Something should be deleted, deprecated, or descoped.
- The scope of the phase is ambiguous in a way that changes what ships.

Give it the mission, the conflict, the concrete options, and ask for a decisive recommendation. Then **verify its factual claims yourself before acting**.

## Scope discipline

Implement the phase, not the phase plus improvements. When you find something out of scope but worth doing (dead code, a stale file), **surface it and let the user decide** — do not fold it in silently. Deleting files or dropping a documented capability is a scope expansion: get explicit approval, even if a sub-agent recommends it.

## Finishing

1. Personally run every Validation criterion in the phase's block and report the actual results.
2. Confirm the user's real data and credentials are untouched (`results/`, `.env` must never be staged, moved, or written by a test).
3. Have `docs` mark the phase **Done** and tick its checkboxes.
4. **Do not commit without explicit instruction** — `specs/roadmap.md` says so at the top. Report what shipped, flag anything held back, and ask.
5. When committing, review the staged set. `git add -A` will sweep in unrelated untracked files (e.g. `.claude/`) — stage deliberately.
