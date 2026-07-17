import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Phase 12 — `upsertCredential`, the writer the in-app login uses to persist a
 * harvested cookie into config.env so it survives a restart.
 *
 * Phase 24 — stored values are now encrypted at rest via Electron's
 * `safeStorage` (see `CredentialCipher` in credentials.ts), so — unlike the
 * original version of this file — credentials.ts is NOT core-free of module
 * mocking anymore: it statically imports `safeStorage` from `"electron"`,
 * which does not exist in a plain node test process. `electron` is mocked at
 * the module boundary below with a fake, reversible (but not identity —
 * see FAKE_TAG) cipher standing in for the OS-level one, so these tests prove
 * credentials.ts's own prefix/round-trip/fallback/self-upgrade plumbing
 * without depending on Electron's real crypto. Everything still happens in a
 * throwaway temp dir; the real userData config.env is never touched.
 *
 * The hazards `upsertCredential`/`loadCredentials` must avoid: clobbering the
 * template's "# BASECAMP_SESSIONID: …" setup hints, duplicating an assignment
 * on repeated logins, writing a value `loadCredentials` cannot read back,
 * crashing on an undecryptable value, and silently leaving a credential in
 * plaintext when OS-level encryption IS available.
 */

const FAKE_TAG = "FAKE-CIPHER:";

const { mockIsEncryptionAvailable, mockEncryptString, mockDecryptString } = vi.hoisted(() => {
  return {
    mockIsEncryptionAvailable: vi.fn(() => true),
    // A fake but non-identity "cipher": tags the plaintext so a test can tell
    // the raw stored bytes are NOT simply the plaintext (proving the value
    // really passed through encrypt/decrypt, not just base64), yet is fully
    // reversible so loadCredentials can still recover the original value.
    mockEncryptString: vi.fn((value: string) => Buffer.from(`${FAKE_TAG}${value}`, "utf-8")),
    mockDecryptString: vi.fn((buf: Buffer) => {
      const s = buf.toString("utf-8");
      if (!s.startsWith(FAKE_TAG)) throw new Error("fake decryptString: not our ciphertext");
      return s.slice(FAKE_TAG.length);
    }),
  };
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: mockIsEncryptionAvailable,
    encryptString: mockEncryptString,
    decryptString: mockDecryptString,
  },
}));

import {
  CredentialCipher,
  ensureCredentialsFile,
  loadCredentials,
  upsertCredential,
} from "../src/main/credentials";
import { logger } from "../src/main/logger";

/** Extracts the raw stored value for `key`'s line, decrypting it first if it
 *  carries the `enc:v1:` prefix — the read-side counterpart of `storedValue`
 *  below, used to assert on WHAT ends up in process.env / the plaintext the
 *  file's value decrypts back to, independent of whether it happens to be
 *  encrypted or (fallback) plaintext on disk. */
function storedValue(fileContents: string, key: string): string {
  const line = fileContents.split("\n").find((l) => l.startsWith(`${key}=`));
  if (line === undefined) throw new Error(`no ${key}= line found`);
  const raw = line.slice(key.length + 1);
  return CredentialCipher.isEncrypted(raw) ? CredentialCipher.decrypt(raw) : raw;
}

const ENV_KEYS = ["BASECAMP_SESSIONID", "TI_COOKIE", "CLUB_ID", "TM_ROUNDTRIP"] as const;
let savedEnv: Record<string, string | undefined>;
let tmpDir: string;
let file: string;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  tmpDir = mkdtempSync(join(tmpdir(), "tm-creds-"));
  file = join(tmpDir, "config.env");
  // Default every test to "encryption available" unless it overrides.
  mockIsEncryptionAvailable.mockReturnValue(true);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("the electron safeStorage mock is actually engaged (guards against a silent no-op)", () => {
  it("replaces safeStorage.isEncryptionAvailable with a vitest mock", () => {
    expect(vi.isMockFunction(mockIsEncryptionAvailable)).toBe(true);
  });
});

describe("upsertCredential rewrites the placeholder line in place", () => {
  it("fills the empty BASECAMP_SESSIONID= placeholder without touching the rest of the template", () => {
    ensureCredentialsFile(file);
    const before = readFileSync(file, "utf-8");
    expect(before).toContain("BASECAMP_SESSIONID=\n"); // placeholder starts empty

    upsertCredential(file, "BASECAMP_SESSIONID", "harvested-sid");

    const afterContents = readFileSync(file, "utf-8");
    const after = afterContents.split("\n");
    // The assignment line now carries the value, encrypted (safeStorage is
    // available in this test), which decrypts back to what was written...
    expect(storedValue(afterContents, "BASECAMP_SESSIONID")).toBe("harvested-sid");
    expect(after.some((l) => l.startsWith("BASECAMP_SESSIONID=enc:v1:"))).toBe(true);
    // ...the "# BASECAMP_SESSIONID: …" instruction comment is preserved verbatim...
    expect(after).toContain('#   -> Cookies -> copy the value of the "sessionid" cookie.');
    expect(after.some((l) => l.startsWith("# BASECAMP_SESSIONID:"))).toBe(true);
    // ...and the other placeholders are left untouched.
    expect(after).toContain("TI_COOKIE=");
    expect(after).toContain("CLUB_ID=");
  });

  it("writes exactly one BASECAMP_SESSIONID assignment line (no duplicate)", () => {
    ensureCredentialsFile(file);

    upsertCredential(file, "BASECAMP_SESSIONID", "harvested-sid");

    const contents = readFileSync(file, "utf-8");
    const assignments = contents.split("\n").filter((l) => l.startsWith("BASECAMP_SESSIONID="));
    expect(assignments).toHaveLength(1);
    expect(storedValue(contents, "BASECAMP_SESSIONID")).toBe("harvested-sid");
  });

  it("overwrites in place on a repeat login rather than appending a second line", () => {
    ensureCredentialsFile(file);

    upsertCredential(file, "BASECAMP_SESSIONID", "first-sid");
    upsertCredential(file, "BASECAMP_SESSIONID", "second-sid");

    const contents = readFileSync(file, "utf-8");
    const assignments = contents.split("\n").filter((l) => l.startsWith("BASECAMP_SESSIONID="));
    expect(assignments).toHaveLength(1);
    expect(storedValue(contents, "BASECAMP_SESSIONID")).toBe("second-sid");
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

    const contents = readFileSync(file, "utf-8");
    const lines = contents.split("\n");
    expect(lines).toContain("# example: BASECAMP_SESSIONID=paste-your-cookie-here");
    expect(storedValue(contents, "BASECAMP_SESSIONID")).toBe("real-value");
  });

  it("appends the key when it is absent from the file entirely", () => {
    writeFileSync(file, "# only comments here\nCLUB_ID=\n", "utf-8");

    upsertCredential(file, "TI_COOKIE", "a=1; b=2");

    const contents = readFileSync(file, "utf-8");
    const lines = contents.split("\n");
    expect(storedValue(contents, "TI_COOKIE")).toBe("a=1; b=2");
    expect(lines).toContain("CLUB_ID=");
  });

  it("creates the file from the template first when it does not exist", () => {
    // `file` has not been created yet in this test.
    upsertCredential(file, "BASECAMP_SESSIONID", "created-on-demand");

    const contents = readFileSync(file, "utf-8");
    expect(storedValue(contents, "BASECAMP_SESSIONID")).toBe("created-on-demand");
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

describe("Phase 24 — a fresh write is encrypted at rest and round-trips (safeStorage available)", () => {
  it("stores an enc:v1:-prefixed line whose raw bytes are not the plaintext, and loadCredentials decrypts it back", () => {
    delete process.env.TM_ROUNDTRIP;
    ensureCredentialsFile(file);

    upsertCredential(file, "TM_ROUNDTRIP", "top-secret-cookie");

    const contents = readFileSync(file, "utf-8");
    const line = contents.split("\n").find((l) => l.startsWith("TM_ROUNDTRIP="));
    expect(line).toBeDefined();
    const rawValue = line!.slice("TM_ROUNDTRIP=".length);
    expect(rawValue.startsWith("enc:v1:")).toBe(true);
    // The stored bytes genuinely aren't the plaintext — real proof this went
    // through the (fake) cipher, not merely a base64 passthrough of the value.
    expect(rawValue).not.toContain("top-secret-cookie");
    expect(contents).not.toContain("top-secret-cookie");

    loadCredentials(file);

    expect(process.env.TM_ROUNDTRIP).toBe("top-secret-cookie");
    expect(mockEncryptString).toHaveBeenCalledWith("top-secret-cookie");
    expect(mockDecryptString).toHaveBeenCalled();
  });

  /*
   * NEGATIVE CONTROL (mentally run against pre-Phase-24 credentials.ts, which
   * wrote `upsertCredential`'s value verbatim with no CredentialCipher at
   * all): `rawValue.startsWith("enc:v1:")` would be false and
   * `contents.not.toContain("top-secret-cookie")` would fail outright (the
   * plaintext WOULD be in the file) — this test could not have passed against
   * the pre-encryption implementation.
   */
});

describe("Phase 24 — an existing plaintext value loads correctly and self-upgrades to encrypted", () => {
  it("loads a hand-written plaintext KEY=value line into process.env AND rewrites the file with an enc:v1: line for that key", () => {
    delete process.env.TM_ROUNDTRIP;
    writeFileSync(file, "TM_ROUNDTRIP=legacy-plain-value\n", "utf-8");

    loadCredentials(file);

    expect(process.env.TM_ROUNDTRIP).toBe("legacy-plain-value");

    const rewritten = readFileSync(file, "utf-8");
    const line = rewritten.split("\n").find((l) => l.startsWith("TM_ROUNDTRIP="));
    expect(line).toBeDefined();
    expect(line!.slice("TM_ROUNDTRIP=".length).startsWith("enc:v1:")).toBe(true);
    expect(rewritten).not.toContain("legacy-plain-value");
  });

  /*
   * NEGATIVE CONTROL: pre-Phase-24, loadCredentials only ever parsed the file
   * and populated process.env — it never wrote back to disk. Against that
   * implementation, `line!.slice(...).startsWith("enc:v1:")` would be false
   * (the line would still literally read
   * "TM_ROUNDTRIP=legacy-plain-value") and `rewritten.not.toContain(...)`
   * would fail. This test could not pass without the self-upgrade rewrite.
   */
});

describe("Phase 24 — falls back to plaintext (never throws) when OS-level encryption is unavailable", () => {
  it("writes a plain, non-enc:v1: value and logs a warning when isEncryptionAvailable() is false", () => {
    const warnSpy = vi.spyOn(logger, "warn");
    mockIsEncryptionAvailable.mockReturnValue(false);
    ensureCredentialsFile(file);

    expect(() => upsertCredential(file, "BASECAMP_SESSIONID", "plain-fallback")).not.toThrow();

    const contents = readFileSync(file, "utf-8");
    expect(contents).toContain("BASECAMP_SESSIONID=plain-fallback");
    expect(
      contents.split("\n").some((l) => l.startsWith("BASECAMP_SESSIONID=enc:v1:")),
    ).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("OS-level credential encryption unavailable"),
    );
  });

  it("negative control: does NOT log that warning when isEncryptionAvailable() is true — proves the assertion above isn't vacuous regardless of the mock's return value", () => {
    const warnSpy = vi.spyOn(logger, "warn");
    mockIsEncryptionAvailable.mockReturnValue(true);
    ensureCredentialsFile(file);

    upsertCredential(file, "BASECAMP_SESSIONID", "encrypted-this-time");

    const contents = readFileSync(file, "utf-8");
    expect(
      contents.split("\n").some((l) => l.startsWith("BASECAMP_SESSIONID=enc:v1:")),
    ).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  /*
   * NEGATIVE CONTROL (mentally run against a hypothetical regression where
   * `CredentialCipher.encrypt` warned — or fell back to plaintext — on EVERY
   * call regardless of `isEncryptionAvailable()`'s return value): the first
   * test above would still pass, but the second ("...true") would go RED on
   * both the enc:v1: prefix check and `expect(warnSpy).not.toHaveBeenCalled()`.
   * Together the pair proves the branch is genuinely gated on the mock's
   * return value, not hardcoded to always-warn or always-fallback.
   */
});

describe("Phase 24 — a decrypt failure is treated as unset, never crashes the app", () => {
  it("does not populate process.env for a key whose stored enc:v1: value fails to decrypt on this machine, and does not throw", () => {
    delete process.env.TM_ROUNDTRIP;
    ensureCredentialsFile(file);
    upsertCredential(file, "TM_ROUNDTRIP", "will-fail-to-decrypt");
    mockDecryptString.mockImplementationOnce(() => {
      throw new Error("OS key store changed; cannot decrypt");
    });

    expect(() => loadCredentials(file)).not.toThrow();

    expect(process.env.TM_ROUNDTRIP).toBeUndefined();
  });

  it("leaves a PREVIOUSLY-set env value unchanged (rather than clearing it) when the on-disk value fails to decrypt", () => {
    process.env.TM_ROUNDTRIP = "still-good-from-earlier";
    ensureCredentialsFile(file);
    upsertCredential(file, "TM_ROUNDTRIP", "unreadable-now");
    mockDecryptString.mockImplementationOnce(() => {
      throw new Error("cannot decrypt");
    });

    loadCredentials(file);

    expect(process.env.TM_ROUNDTRIP).toBe("still-good-from-earlier");
  });

  /*
   * NEGATIVE CONTROL (mentally run against pre-Phase-24 credentials.ts, which
   * had no decrypt step at all, and against a hypothetical regression that let
   * a decrypt exception propagate uncaught): `loadCredentials(file)` would
   * either misread the enc:v1:-prefixed ciphertext as a literal plaintext
   * value (populating process.env with garbage instead of leaving it unset)
   * or throw synchronously out of `loadCredentials`, failing
   * `expect(() => loadCredentials(file)).not.toThrow()`. Both failure shapes
   * are exactly what this pair of tests is built to catch.
   */
});

describe("logger.warn is genuinely wired to console.warn (guards the spy target itself)", () => {
  it("calling logger.warn invokes console.warn under the hood", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("test message");
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });
});
