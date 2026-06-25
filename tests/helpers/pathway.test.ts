import { describe, it, expect } from "vitest";
import {
  pathwayInitials,
  isOverviewLesson,
  isLevelDone,
  nextLevelToComplete,
  nextLevelFromFlags,
  titleFromFlags,
  STANDARD_LEVELS,
} from "../../helpers/pathway.js";

// ---------------------------------------------------------------------------
// pathwayInitials
// ---------------------------------------------------------------------------

describe("pathwayInitials", () => {
  // Known pathways from Toastmasters Basecamp — all must map to their two-letter code
  it("maps 'Presentation Mastery' to 'PM'", () => {
    expect(pathwayInitials("Presentation Mastery")).toBe("PM");
  });

  it("maps 'Dynamic Leadership' to 'DL'", () => {
    expect(pathwayInitials("Dynamic Leadership")).toBe("DL");
  });

  it("maps 'Persuasive Influence' to 'PI'", () => {
    expect(pathwayInitials("Persuasive Influence")).toBe("PI");
  });

  it("maps 'Team Collaboration' to 'TC'", () => {
    expect(pathwayInitials("Team Collaboration")).toBe("TC");
  });

  it("maps 'Effective Coaching' to 'EC'", () => {
    expect(pathwayInitials("Effective Coaching")).toBe("EC");
  });

  it("maps 'Innovative Planning' to 'IP'", () => {
    expect(pathwayInitials("Innovative Planning")).toBe("IP");
  });

  it("maps 'Visionary Communication' to 'VC'", () => {
    expect(pathwayInitials("Visionary Communication")).toBe("VC");
  });

  it("maps 'Strategic Relationships' to 'SR'", () => {
    expect(pathwayInitials("Strategic Relationships")).toBe("SR");
  });

  it("maps 'Leadership Development' to 'LD'", () => {
    expect(pathwayInitials("Leadership Development")).toBe("LD");
  });

  it("maps 'Engaging Humor' to 'EH'", () => {
    expect(pathwayInitials("Engaging Humor")).toBe("EH");
  });

  it("maps 'Motivational Strategies' to 'MS'", () => {
    expect(pathwayInitials("Motivational Strategies")).toBe("MS");
  });

  // Parenthesised suffix must be stripped before computing initials
  it("strips parenthesised suffix — 'Dynamic Leadership (Simplified Chinese)' maps to 'DL'", () => {
    expect(pathwayInitials("Dynamic Leadership (Simplified Chinese)")).toBe("DL");
  });

  it("strips any parenthesised suffix regardless of content", () => {
    expect(pathwayInitials("Visionary Communication (Traditional Chinese)")).toBe("VC");
  });

  // Edge cases
  it("handles a single-word name by returning its first letter uppercased", () => {
    expect(pathwayInitials("Leadership")).toBe("L");
  });

  it("returns an empty string for an empty input", () => {
    expect(pathwayInitials("")).toBe("");
  });

  it("returns uppercase initials even when input is lowercase", () => {
    expect(pathwayInitials("presentation mastery")).toBe("PM");
  });

  it("handles extra whitespace between words", () => {
    expect(pathwayInitials("Presentation  Mastery")).toBe("PM");
  });

  it("handles a name that is only a parenthesised clause after stripping", () => {
    // e.g. "(Foo)" — after stripping parens the name is empty
    expect(pathwayInitials("(Foo)")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// isOverviewLesson
// ---------------------------------------------------------------------------

describe("isOverviewLesson", () => {
  // Administrative container lessons that should be excluded from project counts
  it("returns true for 'Path Introduction'", () => {
    expect(isOverviewLesson("Path Introduction")).toBe(true);
  });

  it("returns true for 'Level 1: Mastering Fundamentals' style header", () => {
    expect(isOverviewLesson("Level 1: Mastering Fundamentals")).toBe(true);
  });

  it("returns true for 'Level 2: Learning Your Style'", () => {
    expect(isOverviewLesson("Level 2: Learning Your Style")).toBe(true);
  });

  it("returns true for 'Level 3: Increasing Knowledge'", () => {
    expect(isOverviewLesson("Level 3: Increasing Knowledge")).toBe(true);
  });

  it("returns true for 'Level 4: Building Skills'", () => {
    expect(isOverviewLesson("Level 4: Building Skills")).toBe(true);
  });

  it("returns true for 'Level 5: Demonstrating Expertise'", () => {
    expect(isOverviewLesson("Level 5: Demonstrating Expertise")).toBe(true);
  });

  it("returns true for any Level N: prefixed string", () => {
    expect(isOverviewLesson("Level 10: Some Future Level")).toBe(true);
  });

  // Real speech-project lesson names — must NOT be treated as overview
  it("returns false for a real speech project name", () => {
    expect(isOverviewLesson("Ice Breaker")).toBe(false);
  });

  it("returns false for 'Evaluation and Feedback'", () => {
    expect(isOverviewLesson("Evaluation and Feedback")).toBe(false);
  });

  it("returns false for 'Active Listening'", () => {
    expect(isOverviewLesson("Active Listening")).toBe(false);
  });

  it("returns false for 'Researching and Presenting'", () => {
    expect(isOverviewLesson("Researching and Presenting")).toBe(false);
  });

  it("returns false for 'Leading in Your Volunteer Organization'", () => {
    expect(isOverviewLesson("Leading in Your Volunteer Organization")).toBe(false);
  });

  // Near-misses that should NOT match
  it("returns false for 'Level 1' without a colon (not an overview header)", () => {
    expect(isOverviewLesson("Level 1")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isOverviewLesson("")).toBe(false);
  });

  it("returns false for 'Path Introduction ' with trailing space (exact match only)", () => {
    expect(isOverviewLesson("Path Introduction ")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isLevelDone
// ---------------------------------------------------------------------------

describe("isLevelDone", () => {
  // String "true" in the Approved column → done
  it("returns true when the level's Approved column is the string 'true'", () => {
    const row = { "Level 1 Approved": "true" };
    expect(isLevelDone(row, "Level 1")).toBe(true);
  });

  // Numeric string "1" is also a valid truthy value in some CSV exports
  it("returns true when the level's Approved column is '1'", () => {
    const row = { "Level 2 Approved": "1" };
    expect(isLevelDone(row, "Level 2")).toBe(true);
  });

  // Any other value → not done
  it("returns false when the Approved column is 'false'", () => {
    const row = { "Level 1 Approved": "false" };
    expect(isLevelDone(row, "Level 1")).toBe(false);
  });

  it("returns false when the Approved column is '0'", () => {
    const row = { "Level 3 Approved": "0" };
    expect(isLevelDone(row, "Level 3")).toBe(false);
  });

  it("returns false when the Approved column is absent", () => {
    expect(isLevelDone({}, "Level 2")).toBe(false);
  });

  it("returns false when the Approved column is an empty string", () => {
    const row = { "Level 4 Approved": "" };
    expect(isLevelDone(row, "Level 4")).toBe(false);
  });

  // Path Completion uses a different pair of columns
  it("returns true for Path Completion when completed >= total and total > 0", () => {
    const row = {
      "Path Completion Completed": "5",
      "Path Completion Total": "5",
    };
    expect(isLevelDone(row, "Path Completion")).toBe(true);
  });

  it("returns true for Path Completion when completed exceeds total", () => {
    const row = {
      "Path Completion Completed": "6",
      "Path Completion Total": "5",
    };
    expect(isLevelDone(row, "Path Completion")).toBe(true);
  });

  it("returns false for Path Completion when completed < total", () => {
    const row = {
      "Path Completion Completed": "4",
      "Path Completion Total": "5",
    };
    expect(isLevelDone(row, "Path Completion")).toBe(false);
  });

  it("returns false for Path Completion when total is 0 (uninitialised row)", () => {
    const row = {
      "Path Completion Completed": "0",
      "Path Completion Total": "0",
    };
    expect(isLevelDone(row, "Path Completion")).toBe(false);
  });

  it("returns false for Path Completion when columns are absent (defaults to 0)", () => {
    expect(isLevelDone({}, "Path Completion")).toBe(false);
  });

  // Works for all five standard levels
  it("correctly checks Level 5 Approved", () => {
    const row = { "Level 5 Approved": "true" };
    expect(isLevelDone(row, "Level 5")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nextLevelToComplete
// ---------------------------------------------------------------------------

describe("nextLevelToComplete", () => {
  it("returns 'Level 1' when no levels have been started", () => {
    expect(nextLevelToComplete({})).toBe("Level 1");
  });

  it("returns 'Level 1' when Level 1 Approved is explicitly false", () => {
    const row = { "Level 1 Approved": "false" };
    expect(nextLevelToComplete(row)).toBe("Level 1");
  });

  it("returns 'Level 2' when only Level 1 is approved", () => {
    const row = { "Level 1 Approved": "true" };
    expect(nextLevelToComplete(row)).toBe("Level 2");
  });

  it("returns 'Level 3' when Levels 1 and 2 are approved", () => {
    const row = {
      "Level 1 Approved": "true",
      "Level 2 Approved": "true",
    };
    expect(nextLevelToComplete(row)).toBe("Level 3");
  });

  it("returns 'Level 4' when Levels 1–3 are approved", () => {
    const row = {
      "Level 1 Approved": "true",
      "Level 2 Approved": "true",
      "Level 3 Approved": "true",
    };
    expect(nextLevelToComplete(row)).toBe("Level 4");
  });

  it("returns 'Level 5' when Levels 1–4 are approved", () => {
    const row = {
      "Level 1 Approved": "true",
      "Level 2 Approved": "true",
      "Level 3 Approved": "true",
      "Level 4 Approved": "true",
    };
    expect(nextLevelToComplete(row)).toBe("Level 5");
  });

  it("returns 'Path Completion' when Levels 1–5 are all approved but path not complete", () => {
    const row = {
      "Level 1 Approved": "true",
      "Level 2 Approved": "true",
      "Level 3 Approved": "true",
      "Level 4 Approved": "true",
      "Level 5 Approved": "true",
      "Path Completion Completed": "4",
      "Path Completion Total": "5",
    };
    expect(nextLevelToComplete(row)).toBe("Path Completion");
  });

  it("returns 'Completed' when all five levels and path completion are done", () => {
    const row = {
      "Level 1 Approved": "true",
      "Level 2 Approved": "true",
      "Level 3 Approved": "true",
      "Level 4 Approved": "true",
      "Level 5 Approved": "true",
      "Path Completion Completed": "5",
      "Path Completion Total": "5",
    };
    expect(nextLevelToComplete(row)).toBe("Completed");
  });

  it("returns 'Level 1' when the approved column value is '0' (not approved)", () => {
    const row = { "Level 1 Approved": "0" };
    expect(nextLevelToComplete(row)).toBe("Level 1");
  });

  it("accepts '1' as an approved value — returns next level after Level 1", () => {
    const row = { "Level 1 Approved": "1" };
    expect(nextLevelToComplete(row)).toBe("Level 2");
  });

  // Verify the function respects ordering — Level 2 missing even if 3 is present
  it("returns 'Level 2' if Level 2 is not approved even when Level 3 column is true", () => {
    const row = {
      "Level 1 Approved": "true",
      "Level 2 Approved": "false",
      "Level 3 Approved": "true",
    };
    expect(nextLevelToComplete(row)).toBe("Level 2");
  });
});

// ---------------------------------------------------------------------------
// nextLevelFromFlags
// ---------------------------------------------------------------------------

describe("nextLevelFromFlags", () => {
  const none = { level1: false, level2: false, level3: false, level4: false, level5: false, pathDone: false };

  it("returns 'Level 1' when no levels are approved", () => {
    expect(nextLevelFromFlags(none)).toBe("Level 1");
  });

  it("returns 'Level 2' when only level1 is approved", () => {
    expect(nextLevelFromFlags({ ...none, level1: true })).toBe("Level 2");
  });

  it("returns 'Level 3' when levels 1–2 are approved", () => {
    expect(nextLevelFromFlags({ ...none, level1: true, level2: true })).toBe("Level 3");
  });

  it("returns 'Level 4' when levels 1–3 are approved", () => {
    expect(nextLevelFromFlags({ ...none, level1: true, level2: true, level3: true })).toBe("Level 4");
  });

  it("returns 'Level 5' when levels 1–4 are approved", () => {
    expect(nextLevelFromFlags({ ...none, level1: true, level2: true, level3: true, level4: true })).toBe("Level 5");
  });

  it("returns 'Path Completion' when all five levels are approved but path not done", () => {
    expect(nextLevelFromFlags({ level1: true, level2: true, level3: true, level4: true, level5: true, pathDone: false })).toBe("Path Completion");
  });

  it("returns 'Completed' when all levels and path completion are done", () => {
    expect(nextLevelFromFlags({ level1: true, level2: true, level3: true, level4: true, level5: true, pathDone: true })).toBe("Completed");
  });
});

// ---------------------------------------------------------------------------
// titleFromFlags
// ---------------------------------------------------------------------------

describe("titleFromFlags", () => {
  const none = { level1: false, level2: false, level3: false, level4: false, level5: false };
  const pm = "Presentation Mastery";

  it("returns 'DTM' when credentials contains 'DTM'", () => {
    expect(titleFromFlags(none, pm, "DTM")).toBe("DTM");
  });

  it("returns '' when no levels are approved", () => {
    expect(titleFromFlags(none, pm, "")).toBe("");
  });

  it("returns pathway initials + '1' when only level1 is approved", () => {
    expect(titleFromFlags({ ...none, level1: true }, pm, "")).toBe("PM1");
  });

  it("returns pathway initials + '2' when level2 is the highest approved", () => {
    expect(titleFromFlags({ ...none, level1: true, level2: true }, pm, "")).toBe("PM2");
  });

  it("returns pathway initials + '3' when level3 is the highest approved", () => {
    expect(titleFromFlags({ ...none, level1: true, level2: true, level3: true }, pm, "")).toBe("PM3");
  });

  it("returns pathway initials + '4' when level4 is the highest approved", () => {
    expect(titleFromFlags({ ...none, level1: true, level2: true, level3: true, level4: true }, pm, "")).toBe("PM4");
  });

  it("returns pathway initials + '5' when level5 is approved", () => {
    expect(titleFromFlags({ level1: true, level2: true, level3: true, level4: true, level5: true }, pm, "")).toBe("PM5");
  });
});

// ---------------------------------------------------------------------------
// STANDARD_LEVELS export
// ---------------------------------------------------------------------------

describe("STANDARD_LEVELS", () => {
  it("contains exactly the five standard level labels in order", () => {
    expect(STANDARD_LEVELS).toEqual(["Level 1", "Level 2", "Level 3", "Level 4", "Level 5"]);
  });
});
