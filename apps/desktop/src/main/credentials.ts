/**
 * Credential loading for the packaged app.
 *
 * A packaged app has no repo-root `.env`, so core's own `loadEnvFile()` finds
 * nothing. Credentials instead live in a plain key=value file inside Electron's
 * userData directory, which survives reinstalls and is outside the asar. Values
 * are encrypted at rest (Phase 24) via Electron's `safeStorage` — OS-level
 * encryption (DPAPI on Windows) — so the file is no longer a plaintext bearer
 * token if something else on the machine reads it.
 *
 * The parser below is deliberately *not* core's `loadEnvFile`: importing any core
 * module here would evaluate `config.ts`, freezing `SESSION_ID` / `TI_COOKIE`
 * from a `process.env` that has not been populated yet. See `core.ts`.
 */

import { safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
// logger.ts is core-free too (see its header comment) — safe to import
// statically here for the same reason `auth.ts` does.
import { logger } from "./logger";

const TEMPLATE = `# Toastmasters Tools — credentials
#
# Paste your session cookies below, save this file, then restart the app.
# Nothing here ever leaves your computer. Values are encrypted automatically
# on your computer after the app next loads this file.
#
# BASECAMP_SESSIONID: basecamp.toastmasters.org -> DevTools (F12) -> Application
#   -> Cookies -> copy the value of the "sessionid" cookie.
BASECAMP_SESSIONID=
#
# TI_COOKIE: www.toastmasters.org -> DevTools (F12) -> Application -> Cookies
#   -> copy every cookie as one semicolon-separated string.
TI_COOKIE=
#
# CLUB_ID: only needed if you are not tracking the default club.
CLUB_ID=
`;

/** Self-describing prefix tagging a value as encrypted with this format's v1
 *  scheme, so a loader can tell an encrypted value from legacy plaintext at a
 *  glance without attempting (and failing) a decrypt first. */
const ENCRYPTED_PREFIX = "enc:v1:";

/**
 * Wraps Electron's `safeStorage.encryptString`/`decryptString` (OS-level
 * encryption — DPAPI on Windows, Keychain on macOS, a keyring on Linux) behind
 * the app's own `enc:v1:<base64>` format. Falls back to plaintext — logging a
 * warning, never throwing — when `safeStorage.isEncryptionAvailable()` is
 * false, e.g. a Linux box with no keyring; a locked-out user is worse than a
 * plaintext credential.
 */
export const CredentialCipher = {
  /** Encrypts `value`, or returns it unchanged (with a logged warning) when
   *  OS-level encryption is unavailable. */
  encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn("OS-level credential encryption unavailable; storing credentials as plaintext");
      return value;
    }
    const encrypted = safeStorage.encryptString(value);
    return `${ENCRYPTED_PREFIX}${encrypted.toString("base64")}`;
  },

  /** True when `value` carries this format's encrypted-value prefix. */
  isEncrypted(value: string): boolean {
    return value.startsWith(ENCRYPTED_PREFIX);
  },

  /** Decrypts a previously-`encrypt`ed value. Only ever called on values for
   *  which {@link isEncrypted} is true. */
  decrypt(value: string): string {
    const encrypted = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64");
    return safeStorage.decryptString(encrypted);
  },
};

/** Absolute path of the credentials file inside Electron's userData directory. */
export function credentialsFile(userDataDir: string): string {
  return join(userDataDir, "config.env");
}

/** Creates the credentials file with a commented template if it does not exist. */
export function ensureCredentialsFile(file: string): void {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, TEMPLATE, "utf-8");
}

/**
 * Parses `file` and copies its keys into `process.env`.
 *
 * Real environment variables always win, matching core's `loadEnvFile` semantics,
 * so a developer can still override a value from the shell.
 *
 * A value stored `enc:v1:`-prefixed (see {@link CredentialCipher}) is decrypted
 * before use. A value found as unprefixed plaintext — a legacy `config.env` from
 * before Phase 24, or one the user just hand-pasted via "Open Credentials
 * File…" — is used as-is *and* immediately rewritten encrypted via
 * {@link upsertCredential}, so it self-upgrades with no prompt the next time the
 * app starts.
 */
export function loadCredentials(file: string): void {
  let contents: string;
  try {
    contents = readFileSync(file, "utf-8");
  } catch {
    return; // no credentials yet — the scrapers will report the missing cookie
  }

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    // An empty value is the template's placeholder, not a credential: leaving it
    // unset lets core raise its "BASECAMP_SESSIONID is not set" guidance.
    if (!key || !rawValue) continue;

    let value: string;
    if (CredentialCipher.isEncrypted(rawValue)) {
      try {
        value = CredentialCipher.decrypt(rawValue);
      } catch (err) {
        // A stored value this machine/user can no longer decrypt (e.g. the OS
        // key store changed) must never crash the app — treat it as unset, the
        // same guidance path an absent cookie already takes.
        logger.warn("failed to decrypt stored credential; treating as unset", {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    } else {
      value = rawValue;
      upsertCredential(file, key, value);
    }

    if (value && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/**
 * Rewrites the `KEY=` line of the credentials file in place, creating the file
 * from the template first if it does not exist. All other lines — including the
 * commented setup instructions — are preserved verbatim, and a key absent from
 * the file is appended. Used by the in-app login to persist harvested cookies so
 * they survive a restart, without core ever being imported here (see the header
 * comment and `auth.ts`).
 *
 * `value` is always run through {@link CredentialCipher} before being written,
 * whatever it is — including `CLUB_ID` (a non-secret, so encrypting it too is
 * harmless) and an empty string (logout blanks a credential this way; the
 * resulting `enc:v1:` line still decrypts back to `""`, which `loadCredentials`
 * treats as unset, same as blanking it in plaintext did).
 */
export function upsertCredential(file: string, key: string, value: string): void {
  ensureCredentialsFile(file);
  const lines = readFileSync(file, "utf-8").split("\n");
  const prefix = `${key}=`;
  const stored = CredentialCipher.encrypt(value);

  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trimStart();
    // Skip comments so the template's "# BASECAMP_SESSIONID: …" hint is never
    // mistaken for the assignment line.
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith(prefix)) {
      lines[i] = `${key}=${stored}`;
      replaced = true;
      break;
    }
  }

  if (!replaced) lines.push(`${key}=${stored}`);
  writeFileSync(file, lines.join("\n"), "utf-8");
}
