/**
 * Credential loading for the packaged app.
 *
 * A packaged app has no repo-root `.env`, so core's own `loadEnvFile()` finds
 * nothing. Credentials instead live in a plain key=value file inside Electron's
 * userData directory, which survives reinstalls and is outside the asar.
 *
 * The parser below is deliberately *not* core's `loadEnvFile`: importing any core
 * module here would evaluate `config.ts`, freezing `SESSION_ID` / `TI_COOKIE`
 * from a `process.env` that has not been populated yet. See `core.ts`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const TEMPLATE = `# Toastmasters Tools — credentials
#
# Paste your session cookies below, save this file, then restart the app.
# Nothing here ever leaves your computer.
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
    const value = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    // An empty value is the template's placeholder, not a credential: leaving it
    // unset lets core raise its "BASECAMP_SESSIONID is not set" guidance.
    if (key && value && !(key in process.env)) {
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
 */
export function upsertCredential(file: string, key: string, value: string): void {
  ensureCredentialsFile(file);
  const lines = readFileSync(file, "utf-8").split("\n");
  const prefix = `${key}=`;

  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    // Skip comments so the template's "# BASECAMP_SESSIONID: …" hint is never
    // mistaken for the assignment line.
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith(prefix)) {
      lines[i] = `${key}=${value}`;
      replaced = true;
      break;
    }
  }

  if (!replaced) lines.push(`${key}=${value}`);
  writeFileSync(file, lines.join("\n"), "utf-8");
}
