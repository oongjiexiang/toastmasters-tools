import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  getLatestMembership,
  getLatestProgress,
  getLatestProjects,
  getMembershipDiff,
  getProgressDiff,
} from "../helpers/db";
import { getDiff, getMemberDetail, listMembers } from "../queries";

/**
 * Direct unit tests for the read-model queries.
 *
 * This logic used to live inside the Next.js API routes and was only ever covered
 * *indirectly*, through `apps/web/tests/api/*`. Phase 11 moved it into core so the
 * Electron main process could reuse it; these tests move the coverage with it, and
 * exercise the rules through core's own surface rather than through HTTP.
 *
 * `helpers/db` is mocked at the module boundary: these tests describe the mapping
 * rules, not SQLite, and they must never touch the user's real results/db.sqlite.
 */
vi.mock("../helpers/db", () => ({
  getLatestProgress: vi.fn(),
  getLatestMembership: vi.fn(),
  getLatestProjects: vi.fn(),
  getProgressDiff: vi.fn(),
  getMembershipDiff: vi.fn(),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

type ProgressRow = ReturnType<typeof progressRow>;

function progressRow(overrides: Partial<{
  email: string;
  firstName: string;
  lastName: string;
  pathName: string;
  level1: boolean;
  level2: boolean;
  level3: boolean;
  level4: boolean;
  level5: boolean;
  pathDone: boolean;
}> = {}) {
  return {
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Smith",
    pathName: "Presentation Mastery",
    level1: false,
    level2: false,
    level3: false,
    level4: false,
    level5: false,
    pathDone: false,
    ...overrides,
  };
}

function membershipRow(overrides: Partial<{
  email: string;
  name: string;
  status: string;
  credentials: string;
}> = {}) {
  return {
    email: "alice@example.com",
    name: "Alice Smith",
    status: "Active",
    credentials: "",
    ...overrides,
  };
}

function project(
  lesson: string,
  complete: boolean,
  level = "Level 1",
  type = "Core",
) {
  return {
    email: "alice@example.com",
    pathName: "Presentation Mastery",
    level,
    lesson,
    complete,
    type,
  };
}

/** Feeds the mocked db module a whole world in one call. */
function givenSnapshots(opts: {
  progress?: ProgressRow[] | null;
  membership?: ReturnType<typeof membershipRow>[] | null;
  projects?: ReturnType<typeof project>[];
}): void {
  // `?? []` would be wrong here: an explicit `null` means "no snapshot exists" and
  // must reach the query unchanged. Only `undefined` defaults to empty.
  const progress = opts.progress === undefined ? [] : opts.progress;
  const membership = opts.membership === undefined ? [] : opts.membership;

  vi.mocked(getLatestProgress).mockReturnValue(progress as never);
  vi.mocked(getLatestMembership).mockReturnValue(membership as never);
  vi.mocked(getLatestProjects).mockReturnValue((opts.projects ?? []) as never);
}

beforeEach(() => vi.clearAllMocks());

// ── listMembers ──────────────────────────────────────────────────────────────

describe("listMembers", () => {
  it("fails with SNAPSHOT_MISSING when the progress snapshot is absent", () => {
    givenSnapshots({ progress: null, membership: [membershipRow()] });

    const result = listMembers();

    expect(result).toEqual({
      ok: false,
      code: "SNAPSHOT_MISSING",
      message: "No data yet — use the Refresh buttons to load member data.",
    });
  });

  it("fails with SNAPSHOT_MISSING when the membership snapshot is absent", () => {
    givenSnapshots({ progress: [progressRow()], membership: null });

    const result = listMembers();

    expect(result).toMatchObject({ ok: false, code: "SNAPSHOT_MISSING" });
  });

  it("returns one row per member with their full name", () => {
    givenSnapshots({ progress: [progressRow()], membership: [membershipRow()] });

    const result = listMembers();

    expect(result).toMatchObject({
      ok: true,
      data: [{ email: "alice@example.com", name: "Alice Smith" }],
    });
  });

  it("sorts members by name", () => {
    givenSnapshots({
      progress: [
        progressRow({ email: "z@example.com", firstName: "Zoe", lastName: "Adams" }),
        progressRow({ email: "b@example.com", firstName: "Bob", lastName: "Brown" }),
      ],
      membership: [
        membershipRow({ email: "z@example.com" }),
        membershipRow({ email: "b@example.com" }),
      ],
    });

    const result = listMembers();

    expect(result.ok && result.data.map((m) => m.name)).toEqual([
      "Bob Brown",
      "Zoe Adams",
    ]);
  });

  it("passes the injected dbPath through to every db query", () => {
    givenSnapshots({ progress: [progressRow()], membership: [membershipRow()] });

    listMembers("/tmp/fixture.sqlite");

    expect(getLatestProgress).toHaveBeenCalledWith("/tmp/fixture.sqlite");
    expect(getLatestMembership).toHaveBeenCalledWith("/tmp/fixture.sqlite");
    expect(getLatestProjects).toHaveBeenCalledWith(
      "alice@example.com",
      "Presentation Mastery",
      "/tmp/fixture.sqlite",
    );
  });
});

// ── Status computation ───────────────────────────────────────────────────────

describe("listMembers status computation", () => {
  function statusFor(rows: ReturnType<typeof project>[], progress = progressRow()) {
    givenSnapshots({
      progress: [progress],
      membership: [membershipRow()],
      projects: rows,
    });
    const result = listMembers();
    if (!result.ok) throw new Error("expected ok");
    return result.data[0].pathways[0];
  }

  it("reports 'completed' when every level and the path itself are approved", () => {
    const pathway = statusFor(
      [],
      progressRow({
        level1: true,
        level2: true,
        level3: true,
        level4: true,
        level5: true,
        pathDone: true,
      }),
    );

    expect(pathway).toMatchObject({ nextLevel: "Completed", status: "completed" });
  });

  it("reports 'ready' when every project in the next level is done but the level is unapproved", () => {
    const pathway = statusFor([
      project("Ice Breaker", true),
      project("Evaluation and Feedback", true),
    ]);

    expect(pathway).toMatchObject({
      nextLevel: "Level 1",
      remaining: 0,
      status: "ready",
    });
  });

  it("reports 'close' when exactly one project remains", () => {
    const pathway = statusFor([
      project("Ice Breaker", true),
      project("Evaluation and Feedback", false),
    ]);

    expect(pathway).toMatchObject({ remaining: 1, status: "close" });
  });

  it("reports 'in-progress' when some but not most projects are done", () => {
    const pathway = statusFor([
      project("Ice Breaker", true),
      project("Evaluation and Feedback", false),
      project("Researching and Presenting", false),
    ]);

    expect(pathway).toMatchObject({ remaining: 2, status: "in-progress" });
  });

  it("reports 'not-started' when no project in the next level is done", () => {
    const pathway = statusFor([
      project("Ice Breaker", false),
      project("Evaluation and Feedback", false),
    ]);

    expect(pathway).toMatchObject({ remaining: 2, status: "not-started" });
  });

  it("reports 'not-started' with no remaining projects on Path Completion", () => {
    const pathway = statusFor(
      [project("Reflect on Your Path", false, "Path Completion")],
      progressRow({
        level1: true,
        level2: true,
        level3: true,
        level4: true,
        level5: true,
        pathDone: false,
      }),
    );

    // Path Completion has no countable projects: the level is a formality once the
    // five levels are approved, so nothing is "remaining".
    expect(pathway).toMatchObject({
      nextLevel: "Path Completion",
      remaining: 0,
      status: "not-started",
    });
  });

  it("ignores overview lessons when counting the next level's projects", () => {
    const pathway = statusFor([
      project("Level 1: Mastering Fundamentals", false),
      project("Path Introduction", false),
      project("Ice Breaker", true),
    ]);

    // Only "Ice Breaker" counts — so the level is complete, not 1-of-3.
    expect(pathway).toMatchObject({ remaining: 0, status: "ready" });
  });

  it("ignores projects belonging to a level other than the next one", () => {
    const pathway = statusFor([
      project("Ice Breaker", false, "Level 1"),
      project("Understanding Your Leadership Style", false, "Level 2"),
    ]);

    expect(pathway).toMatchObject({ nextLevel: "Level 1", remaining: 1 });
  });
});

// ── Titles ───────────────────────────────────────────────────────────────────

describe("listMembers overall title", () => {
  it("uses DTM when the membership credentials contain DTM", () => {
    givenSnapshots({
      progress: [progressRow({ level1: true })],
      membership: [membershipRow({ credentials: "DTM" })],
    });

    const result = listMembers();

    expect(result.ok && result.data[0].title).toBe("DTM");
  });

  it("picks the highest level title across a member's pathways", () => {
    givenSnapshots({
      progress: [
        progressRow({ pathName: "Dynamic Leadership", level1: true }),
        progressRow({
          pathName: "Presentation Mastery",
          level1: true,
          level2: true,
          level3: true,
        }),
      ],
      membership: [membershipRow()],
    });

    const result = listMembers();

    // DL1 vs PM3 — the numeric suffix decides, not the alphabet.
    expect(result.ok && result.data[0].title).toBe("PM3");
    expect(result.ok && result.data[0].pathways.map((p) => p.title)).toEqual([
      "DL1",
      "PM3",
    ]);
  });

  it("returns an empty title when the member has not completed any level", () => {
    givenSnapshots({ progress: [progressRow()], membership: [membershipRow()] });

    const result = listMembers();

    expect(result.ok && result.data[0].title).toBe("");
  });

  it("derives the title from the pathway initials, ignoring a parenthesised suffix", () => {
    givenSnapshots({
      progress: [
        progressRow({
          pathName: "Dynamic Leadership (Simplified Chinese)",
          level1: true,
          level2: true,
        }),
      ],
      membership: [membershipRow()],
    });

    const result = listMembers();

    expect(result.ok && result.data[0].title).toBe("DL2");
  });
});

// ── UnpaidMember handling ────────────────────────────────────────────────────

describe("listMembers UnpaidMember handling", () => {
  it("drops a member whose every pathway belongs to an UnpaidMember", () => {
    givenSnapshots({
      progress: [
        progressRow({ pathName: "Presentation Mastery" }),
        progressRow({ pathName: "Dynamic Leadership" }),
      ],
      membership: [membershipRow({ status: "UnpaidMember" })],
    });

    const result = listMembers();

    expect(result.ok && result.data).toEqual([]);
  });

  it("keeps paid members when an unpaid member is present in the same snapshot", () => {
    givenSnapshots({
      progress: [
        progressRow({ email: "alice@example.com" }),
        progressRow({ email: "bob@example.com", firstName: "Bob", lastName: "Brown" }),
      ],
      membership: [
        membershipRow({ email: "alice@example.com", status: "UnpaidMember" }),
        membershipRow({ email: "bob@example.com", status: "Active" }),
      ],
    });

    const result = listMembers();

    expect(result.ok && result.data.map((m) => m.email)).toEqual(["bob@example.com"]);
  });

  it("keeps a member who has a progress row but no membership row at all", () => {
    // Absent membership is not the same as UnpaidMember: only an explicit
    // "UnpaidMember" status excludes someone.
    givenSnapshots({ progress: [progressRow()], membership: [] });

    const result = listMembers();

    expect(result.ok && result.data).toHaveLength(1);
  });
});

// ── getMemberDetail ──────────────────────────────────────────────────────────

describe("getMemberDetail", () => {
  it("fails with SNAPSHOT_MISSING when the progress snapshot is absent", () => {
    givenSnapshots({ progress: null });

    const result = getMemberDetail("alice@example.com", "Presentation Mastery");

    expect(result).toMatchObject({ ok: false, code: "SNAPSHOT_MISSING" });
  });

  it("fails with NOT_FOUND when the member has no row on that pathway", () => {
    givenSnapshots({ progress: [progressRow()], membership: [membershipRow()] });

    const result = getMemberDetail("alice@example.com", "Visionary Communication");

    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Member not found.",
    });
  });

  it("fails with NOT_FOUND when the email is unknown", () => {
    givenSnapshots({ progress: [progressRow()], membership: [membershipRow()] });

    const result = getMemberDetail("nobody@example.com", "Presentation Mastery");

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("groups projects into Levels 1-5 plus Path Completion, in order", () => {
    givenSnapshots({ progress: [progressRow()], membership: [membershipRow()] });

    const result = getMemberDetail("alice@example.com", "Presentation Mastery");

    expect(result.ok && result.data.levels.map((l) => l.level)).toEqual([
      "Level 1",
      "Level 2",
      "Level 3",
      "Level 4",
      "Level 5",
      "Path Completion",
    ]);
  });

  it("reports each level's approval flag from the progress row", () => {
    givenSnapshots({
      progress: [progressRow({ level1: true, level2: true, pathDone: false })],
      membership: [membershipRow()],
    });

    const result = getMemberDetail("alice@example.com", "Presentation Mastery");

    expect(result.ok && result.data.levels.map((l) => l.approved)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("counts done and total projects per level", () => {
    givenSnapshots({
      progress: [progressRow()],
      membership: [membershipRow()],
      projects: [
        project("Ice Breaker", true, "Level 1"),
        project("Evaluation and Feedback", false, "Level 1"),
        project("Understanding Your Leadership Style", true, "Level 2"),
      ],
    });

    const result = getMemberDetail("alice@example.com", "Presentation Mastery");
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.levels[0]).toMatchObject({ projectsDone: 1, projectsTotal: 2 });
    expect(result.data.levels[1]).toMatchObject({ projectsDone: 1, projectsTotal: 1 });
    expect(result.data.levels[2]).toMatchObject({ projectsDone: 0, projectsTotal: 0 });
  });

  it("excludes overview lessons from the project list", () => {
    givenSnapshots({
      progress: [progressRow()],
      membership: [membershipRow()],
      projects: [
        project("Level 1: Mastering Fundamentals", true, "Level 1"),
        project("Path Introduction", true, "Level 1"),
        project("Ice Breaker", false, "Level 1"),
      ],
    });

    const result = getMemberDetail("alice@example.com", "Presentation Mastery");
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.levels[0].projects).toEqual([
      { lesson: "Ice Breaker", complete: false, type: "Core" },
    ]);
  });

  it("carries the project type through", () => {
    givenSnapshots({
      progress: [progressRow()],
      membership: [membershipRow()],
      projects: [project("Connect with Storytelling", false, "Level 3", "Elective")],
    });

    const result = getMemberDetail("alice@example.com", "Presentation Mastery");
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.levels[2].projects[0].type).toBe("Elective");
  });

  it("titles the member from their level flags and pathway", () => {
    givenSnapshots({
      progress: [progressRow({ level1: true, level2: true })],
      membership: [membershipRow()],
    });

    const result = getMemberDetail("alice@example.com", "Presentation Mastery");

    expect(result.ok && result.data).toMatchObject({
      name: "Alice Smith",
      pathway: "Presentation Mastery",
      title: "PM2",
    });
  });

  it("titles a DTM member DTM regardless of their level flags", () => {
    givenSnapshots({
      progress: [progressRow({ level1: true })],
      membership: [membershipRow({ credentials: "DTM" })],
    });

    const result = getMemberDetail("alice@example.com", "Presentation Mastery");

    expect(result.ok && result.data.title).toBe("DTM");
  });

  it("still resolves the member when the membership snapshot is missing entirely", () => {
    // getMemberDetail only needs membership for the credentials string.
    vi.mocked(getLatestProgress).mockReturnValue([progressRow()] as never);
    vi.mocked(getLatestMembership).mockReturnValue(null);
    vi.mocked(getLatestProjects).mockReturnValue([]);

    const result = getMemberDetail("alice@example.com", "Presentation Mastery");

    expect(result.ok && result.data.title).toBe("");
  });
});

// ── getDiff ──────────────────────────────────────────────────────────────────

describe("getDiff", () => {
  const progressDiff = { advanced: [], newPaths: [], capturedAt: "2026-07-14" };
  const membershipDiff = { joined: [], left: [], statusChanges: [] };

  it("fails with SNAPSHOT_MISSING when there is no progress diff", () => {
    vi.mocked(getProgressDiff).mockReturnValue(null);
    vi.mocked(getMembershipDiff).mockReturnValue(membershipDiff as never);

    expect(getDiff()).toMatchObject({ ok: false, code: "SNAPSHOT_MISSING" });
  });

  it("fails with SNAPSHOT_MISSING when there is no membership diff", () => {
    vi.mocked(getProgressDiff).mockReturnValue(progressDiff as never);
    vi.mocked(getMembershipDiff).mockReturnValue(null);

    expect(getDiff()).toMatchObject({ ok: false, code: "SNAPSHOT_MISSING" });
  });

  it("returns both diffs when both snapshots exist", () => {
    vi.mocked(getProgressDiff).mockReturnValue(progressDiff as never);
    vi.mocked(getMembershipDiff).mockReturnValue(membershipDiff as never);

    expect(getDiff()).toEqual({
      ok: true,
      data: { progress: progressDiff, membership: membershipDiff },
    });
  });

  it("passes the injected dbPath through to both diff queries", () => {
    vi.mocked(getProgressDiff).mockReturnValue(progressDiff as never);
    vi.mocked(getMembershipDiff).mockReturnValue(membershipDiff as never);

    getDiff("/tmp/fixture.sqlite");

    expect(getProgressDiff).toHaveBeenCalledWith("/tmp/fixture.sqlite");
    expect(getMembershipDiff).toHaveBeenCalledWith("/tmp/fixture.sqlite");
  });
});
