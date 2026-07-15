/**
 * The renderer's data layer: a drop-in replacement for `apps/web/lib/api.ts`.
 *
 * Same function names, same signatures, same thrown-Error-on-failure behaviour —
 * only the transport differs (IPC instead of `fetch("/api/…")`). That is what
 * lets the shared components from `apps/web` be reused verbatim.
 */

import type { IpcResult } from "../../shared/ipc";
import type {
  DiffResult,
  MemberDetail,
  MemberSummary,
} from "@toastmasters/core/queries";

export type { DiffResult, MemberDetail, MemberSummary };

/** Mirrors `handleResponse` in the web app: unwrap `data`, or throw the message. */
function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

export async function getMembers(): Promise<MemberSummary[]> {
  return unwrap(await window.toastmasters.listMembers());
}

export async function getMember(
  email: string,
  pathway: string,
): Promise<MemberDetail> {
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

/** Saves the newest membership CSV. Resolves to null when the user cancels. */
export async function downloadMembershipCsv(): Promise<string | null> {
  return unwrap(await window.toastmasters.downloadMembershipCsv());
}
