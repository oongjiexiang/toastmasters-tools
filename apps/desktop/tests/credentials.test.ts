import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ensureCredentialsFile,
  loadCredentials,
  upsertCredential,
} from "../src/main/credentials";

/**
 * Phase 12 — `upsertCredential`, the writer the in-app login uses to persist a
 * harvested cookie into config.env so it survives a restart.
 *
 * The hazards it must avoid: clobbering the template's "# BASECAMP_SESSIONID: …"
 * setup hints, duplicating an assignment on repeated logins, and writing a value
 * that `loadCredentials` cannot read back. credentials.ts is core-free (no electron,
 * no @toastmasters/core), so it needs no module mocking. Everything happens in a
 * throwaway temp dir; the real userData config.env is never touched.
 */

const ENV_KEYS = ["BASECAMP_SESSIONID", "TI_COOKIE", "CLUB_ID", "TM_ROUNDTRIP"] as const;
let savedEnv: Record<string, string | undefined>;
let tmpDir: string;
let file: string;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  tmpDir = mkdtempSync(join(tmpdir(), "tm-creds-"));
  file = join(tmpDir, "config.env");
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("upsertCredential rewrites the placeholder line in place", () => {
  it("fills the empty BASECAMP_SESSIONID= placeholder without touching the rest of the template", () => {
    ensureCredentialsFile(file);
    const before = readFileSync(file, "utf-8");
    expect(before).toContain("BASECAMP_SESSIONID=\n"); // placeholder starts empty

    upsertCredential(file, "BASECAMP_SESSIONID", "harvested-sid");

    const after = readFileSync(file, "utf-8").split("\n");
    // The assignment line now carries the value...
    expect(after).toContain("BASECAMP_SESSIONID=harvested-sid");
    // ...the "# BASECAMP_SESSIONID: …" instruction comment is preserved verbatim...
    expect(after).toContain(
      '#   -> Cookies -> copy the value of the "sessionid" cookie.',
    );
    expect(
      after.some((l) => l.startsWith("# BASECAMP_SESSIONID:")),
    ).toBe(true);
    // ...and the other placeholders are left untouched.
    expect(after).toContain("TI_COOKIE=");
    expect(after).toContain("CLUB_ID=");
  });

  it("writes exactly one BASECAMP_SESSIONID assignment line (no duplicate)", () => {
    ensureCredentialsFile(file);

    upsertCredential(file, "BASECAMP_SESSIONID", "harvested-sid");

    const assignments = readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.startsWith("BASECAMP_SESSIONID="));
    expect(assignments).toEqual(["BASECAMP_SESSIONID=harvested-sid"]);
  });

  it("overwrites in place on a repeat login rather than appending a second line", () => {
    ensureCredentialsFile(file);

    upsertCredential(file, "BASECAMP_SESSIONID", "first-sid");
    upsertCredential(file, "BASECAMP_SESSIONID", "second-sid");

    const assignments = readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.startsWith("BASECAMP_SESSIONID="));
    expect(assignments).toEqual(["BASECAMP_SESSIONID=second-sid"]);
  });

  it("skips a commented-out KEY= line and rewrites the real assignment below it", () => {
    // A hand-crafted file where the key ALSO appears inside a comment. The writer
    // must skip the comment (never mistake the hint for the assignment) and edit
    // only the real line. A naive `includes("BASECAMP_SESSIONID=")` scan would
    // clobber the comment instead.
    writeFileSync(
      file,
      "# example: BASECAMP_SESSIONID=paste-your-cookie-here\nBASECAMP_SESSIONID=\n",
      "utf-8",
    );

    upsertCredential(file, "BASECAMP_SESSIONID", "real-value");

    const lines = readFileSync(file, "utf-8").split("\n");
    expect(lines).toContain("# example: BASECAMP_SESSIONID=paste-your-cookie-here");
    expect(lines).toContain("BASECAMP_SESSIONID=real-value");
  });

  it("appends the key when it is absent from the file entirely", () => {
    writeFileSync(file, "# only comments here\nCLUB_ID=\n", "utf-8");

    upsertCredential(file, "TI_COOKIE", "a=1; b=2");

    const lines = readFileSync(file, "utf-8").split("\n");
    expect(lines).toContain("TI_COOKIE=a=1; b=2");
    expect(lines).toContain("CLUB_ID=");
  });

  it("creates the file from the template first when it does not exist", () => {
    // `file` has not been created yet in this test.
    upsertCredential(file, "BASECAMP_SESSIONID", "created-on-demand");

    const contents = readFileSync(file, "utf-8");
    expect(contents).toContain("BASECAMP_SESSIONID=created-on-demand");
    // The template scaffolding came along with it.
    expect(contents).toContain("# Toastmasters Tools — credentials");
  });
});

describe("a value written by upsertCredential round-trips through loadCredentials", () => {
  it("is readable back into process.env", () => {
    delete process.env.TM_ROUNDTRIP;
    ensureCredentialsFile(file);

    upsertCredential(file, "TM_ROUNDTRIP", "round-trip-value");
    loadCredentials(file);

    expect(process.env.TM_ROUNDTRIP).toBe("round-trip-value");
  });
});
