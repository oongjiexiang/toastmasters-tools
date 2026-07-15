/**
 * The IPC contract between the Electron main process and the renderer.
 *
 * Shared by all three bundles (main, preload, renderer). It must stay free of
 * runtime imports from `@toastmasters/core` — the type-only imports below are
 * erased at build time, so no core code (and no `better-sqlite3`) is ever pulled
 * into the preload or renderer bundle.
 */

import type {
  DiffResult,
  MemberDetail,
  MemberSummary,
} from "@toastmasters/core/queries";

export const IPC = {
  LIST_MEMBERS: "toastmasters:members:list",
  GET_MEMBER: "toastmasters:members:get",
  GET_DIFF: "toastmasters:diff:get",
  REFRESH_PROGRESS: "toastmasters:refresh:progress",
  REFRESH_MEMBERSHIP: "toastmasters:refresh:membership",
  DOWNLOAD_MEMBERSHIP_CSV: "toastmasters:membership:download",
  AUTH_LOGIN: "toastmasters:auth:login",
  AUTH_STATUS: "toastmasters:auth:status",
  // Main → renderer stream (one-way): a progress line emitted during a refresh.
  REFRESH_LOG: "toastmasters:refresh:log",
} as const;

/** Which session cookies are currently held (non-empty). */
export interface AuthStatus {
  basecamp: boolean;
  ti: boolean;
}

/**
 * The IPC analogue of the web app's `{ data } | { error: { code, message } }`
 * HTTP envelope. `code` mirrors `QueryResult`'s discriminant where one exists.
 */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

/** The typed surface exposed on `window.toastmasters` by the preload script. */
export interface ToastmastersBridge {
  listMembers(): Promise<IpcResult<MemberSummary[]>>;
  getMember(email: string, pathway: string): Promise<IpcResult<MemberDetail>>;
  getDiff(): Promise<IpcResult<DiffResult>>;
  refreshProgress(): Promise<IpcResult<null>>;
  refreshMembership(): Promise<IpcResult<null>>;
  /** Resolves to the saved file path, or null when the user cancels the dialog. */
  downloadMembershipCsv(): Promise<IpcResult<string | null>>;
  /** Runs the in-app login flow; resolves to which credentials were obtained. */
  login(): Promise<IpcResult<AuthStatus>>;
  /** Reports which session cookies are currently held (non-empty). */
  authStatus(): Promise<IpcResult<AuthStatus>>;
  /**
   * Subscribes to the live progress lines emitted during a refresh. Returns an
   * unsubscribe function. One-way (main → renderer), so it is not an IpcResult.
   */
  onRefreshLog(listener: (line: string) => void): () => void;
}

export type { DiffResult, MemberDetail, MemberSummary };
