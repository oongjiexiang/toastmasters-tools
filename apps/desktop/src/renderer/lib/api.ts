/**
 * The renderer's data layer: same function names, same signatures, same
 * thrown-Error-on-failure behaviour as the old Next.js dashboard's `lib/api.ts`
 * (removed in Phase 14) — only the transport differs (IPC instead of
 * `fetch("/api/…")`). That is what lets the shared components from
 * `packages/ui` be reused verbatim.
 */

import type { AuthStatus, IpcResult } from "../../shared/ipc";
import type { DiffResult, MemberDetail, MemberSummary } from "@toastmasters/core/queries";

export type { AuthStatus, DiffResult, MemberDetail, MemberSummary };

/**
 * An IPC failure that carries the query's `code` (e.g. "SNAPSHOT_MISSING"), so
 * the UI can distinguish an empty database from a genuine error rather than
 * pattern-matching the message text.
 */
export class IpcError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "IpcError";
    this.code = code;
  }
}

/** Mirrors the old web app's `handleResponse` (removed in Phase 14): unwrap `data`, or throw the message. */
function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new IpcError(result.message, result.code);
  return result.data;
}

export async function getMembers(): Promise<MemberSummary[]> {
  return unwrap(await window.toastmasters.listMembers());
}

export async function getMember(email: string, pathway: string): Promise<MemberDetail> {
  return unwrap(await window.toastmasters.getMember(email, pathway));
}

export async function getDiff(): Promise<DiffResult> {
  return unwrap(await window.toastmasters.getDiff());
}

export async function refreshProgress(): Promise<void> {
  unwrap(await window.toastmasters.refreshProgress());
}

export async function refreshMembership(): Promise<void> {
  unwrap(await window.toastmasters.refreshMembership());
}

/** Aborts the in-flight refresh (progress or membership), if any is running. */
export async function cancelRefresh(): Promise<void> {
  unwrap(await window.toastmasters.cancelRefresh());
}

/** Saves the newest membership CSV. Resolves to null when the user cancels. */
export async function downloadMembershipCsv(): Promise<string | null> {
  return unwrap(await window.toastmasters.downloadMembershipCsv());
}

/** Runs the in-app login flow; resolves to which credentials were obtained. */
export async function logIn(): Promise<AuthStatus> {
  return unwrap(await window.toastmasters.login());
}

/** Reports which session cookies are currently held (non-empty). */
export async function getAuthStatus(): Promise<AuthStatus> {
  return unwrap(await window.toastmasters.authStatus());
}

/** Clears the Toastmasters session; resolves to the (now-cleared) status. */
export async function logOut(): Promise<AuthStatus> {
  return unwrap(await window.toastmasters.logout());
}

/**
 * Subscribes to live progress lines emitted during a refresh. Returns an
 * unsubscribe function; call it on cleanup so listeners don't accumulate.
 */
export function onRefreshLog(listener: (line: string) => void): () => void {
  return window.toastmasters.onRefreshLog(listener);
}
