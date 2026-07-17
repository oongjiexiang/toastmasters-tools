import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from "electron";
import { copyFileSync } from "fs";
import { basename, join } from "path";
import { IPC, type IpcResult } from "../shared/ipc";
import { credentialsFile, ensureCredentialsFile, loadCredentials } from "./credentials";
// auth.ts is core-free (like credentials.ts), so importing it statically here
// does NOT breach the import-order invariant — it never evaluates config.ts.
import {
  applyCookies,
  currentAuthStatus,
  harvestCookies,
  LOGIN_PARTITION,
  logOut,
  runLoginFlow,
} from "./auth";
// logger.ts is likewise core-free — see its header comment for why main
// doesn't route logging through @toastmasters/core/logger instead.
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap. The order of these three steps is load-bearing — see ./core.ts.
//
//   1. Point core's data directory at Electron's userData.
//   2. Load the user's credentials into process.env.
//   3. Only then import core (dynamically, via loadCore()).
//
// Steps 1 and 2 must complete before any core module is *evaluated*, because
// core freezes DATA_DIR / DEFAULT_DB_PATH / SESSION_ID / TI_COOKIE into
// module-level consts at import time.
// ─────────────────────────────────────────────────────────────────────────────

// Without this, Electron derives userData from the package name and the database
// lands in a directory literally called "@toastmasters/desktop" — a scoped name
// containing a path separator. Must precede the first getPath("userData") call.
app.setName("Toastmasters Tools");

const USER_DATA_DIR = app.getPath("userData");
process.env.TOASTMASTERS_DATA_DIR = USER_DATA_DIR;

const CREDENTIALS_FILE = credentialsFile(USER_DATA_DIR);
ensureCredentialsFile(CREDENTIALS_FILE);
loadCredentials(CREDENTIALS_FILE);

type Core = typeof import("./core");

let corePromise: Promise<Core> | null = null;

/** Imports core lazily, so it is never evaluated before the bootstrap above. */
function loadCore(): Promise<Core> {
  corePromise ??= import("./core");
  return corePromise;
}

// ── IPC ──────────────────────────────────────────────────────────────────────

/**
 * Registers a handler that always answers with an IpcResult, mirroring how the
 * old web app's Next.js routes (removed in Phase 14) always answered with
 * `{ data }` or `{ error: { code, message } }`.
 */
function handle<T>(
  channel: string,
  handler: (core: Core, ...args: unknown[]) => Promise<IpcResult<T>>,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await handler(await loadCore(), ...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code: "SERVER_ERROR", message } satisfies IpcResult<T>;
    }
  });
}

/**
 * Registers an auth handler that always answers with an IpcResult. Unlike
 * `handle`, it does NOT load core — the login flow reads cookies straight from
 * Electron's session store, so routing it through `loadCore()` would needlessly
 * evaluate core (and could do so before credentials are populated).
 */
function handleAuth<T>(channel: string, handler: () => Promise<IpcResult<T>>): void {
  ipcMain.handle(channel, async () => {
    try {
      return await handler();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code: "SERVER_ERROR", message } satisfies IpcResult<T>;
    }
  });
}

// The AbortController backing the currently in-flight refresh, if any. Only one
// refresh can run at a time (both Refresh buttons disable together already), so
// a single module-level slot is enough — REFRESH_CANCEL just aborts it.
let currentRefreshController: AbortController | null = null;

/**
 * Registers a refresh handler that streams the scraper's progress lines back to
 * the calling renderer over REFRESH_LOG while it runs, then answers with the
 * usual IpcResult. The `isDestroyed` guard avoids sending to a closed window.
 */
function handleRefresh(
  channel: string,
  run: (core: Core, report: (line: string) => void, signal: AbortSignal) => Promise<void>,
): void {
  ipcMain.handle(channel, async (event) => {
    const controller = new AbortController();
    currentRefreshController = controller;
    const report = (line: string): void => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.REFRESH_LOG, line);
    };
    try {
      await run(await loadCore(), report, controller.signal);
      return { ok: true, data: null } satisfies IpcResult<null>;
    } catch (err) {
      // Checked by `.name`, not `instanceof CancelledError` — this file must
      // stay free of a static @toastmasters/core import (see loadCore()'s
      // header comment above).
      if (err instanceof Error && err.name === "CancelledError") {
        return {
          ok: false,
          code: "CANCELLED",
          message: "Refresh cancelled.",
        } satisfies IpcResult<null>;
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code: "SERVER_ERROR", message } satisfies IpcResult<null>;
    } finally {
      currentRefreshController = null;
    }
  });
}

/** Maps core's transport-agnostic QueryResult onto the IPC envelope. */
function fromQuery<T>(
  result: { ok: true; data: T } | { ok: false; code: string; message: string },
): IpcResult<T> {
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, code: result.code, message: result.message };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function registerIpcHandlers(): void {
  handle(IPC.LIST_MEMBERS, async (core) => fromQuery(core.listMembers()));

  handle(IPC.GET_MEMBER, async (core, rawEmail, rawPathway) => {
    const email = requireString(rawEmail, "email");
    const pathway = requireString(rawPathway, "pathway");
    return fromQuery(core.getMemberDetail(email, pathway));
  });

  handle(IPC.GET_DIFF, async (core) => fromQuery(core.getDiff()));

  handleRefresh(IPC.REFRESH_PROGRESS, (core, report, signal) => core.runFetch(report, signal));

  handleRefresh(IPC.REFRESH_MEMBERSHIP, (core, report, signal) =>
    core.runMembership(report, signal),
  );

  handleAuth(IPC.REFRESH_CANCEL, async () => {
    currentRefreshController?.abort();
    return { ok: true, data: null };
  });

  handle(IPC.DOWNLOAD_MEMBERSHIP_CSV, async (core) => {
    const source = core.findLatestMembershipFile(core.RESULTS_DIR);
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Save membership CSV",
      defaultPath: join(app.getPath("downloads"), basename(source)),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });

    if (canceled || !filePath) return { ok: true, data: null };

    copyFileSync(source, filePath);
    return { ok: true, data: filePath };
  });

  handleAuth(IPC.AUTH_LOGIN, async () => {
    const applied = await runLoginFlow(CREDENTIALS_FILE);
    return { ok: true, data: applied };
  });

  handleAuth(IPC.AUTH_STATUS, async () => {
    const status = await currentAuthStatus(session.fromPartition(LOGIN_PARTITION));
    return { ok: true, data: status };
  });

  handleAuth(IPC.AUTH_LOGOUT, async () => {
    const status = await logOut(CREDENTIALS_FILE, session.fromPartition(LOGIN_PARTITION));
    return { ok: true, data: status };
  });
}

/** Runs the login flow from the menu, then reloads the focused window so the
 *  dashboard re-fetches with the freshly harvested cookies. */
async function runLoginFromMenu(): Promise<void> {
  try {
    await runLoginFlow(CREDENTIALS_FILE);
  } catch (err) {
    logger.error("login failed", { error: err instanceof Error ? err.message : String(err) });
  }
  BrowserWindow.getFocusedWindow()?.webContents.reload();
}

/** Runs the logout from the menu, then reloads the focused window so the
 *  header badge immediately reflects the cleared session. */
async function runLogoutFromMenu(): Promise<void> {
  try {
    await logOut(CREDENTIALS_FILE, session.fromPartition(LOGIN_PARTITION));
  } catch (err) {
    logger.error("logout failed", { error: err instanceof Error ? err.message : String(err) });
  }
  BrowserWindow.getFocusedWindow()?.webContents.reload();
}

// ── Window & menu ────────────────────────────────────────────────────────────

function createMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          {
            // The primary path: log in on the real Toastmasters pages and let the
            // app harvest the cookies. "Open Credentials File…" below is the
            // manual fallback if login does not work.
            label: "Log in to Toastmasters…",
            click: () => void runLoginFromMenu(),
          },
          {
            // Clears the live session partition (not just config.env) — see
            // logOut's doc comment in auth.ts for why that distinction matters.
            label: "Log out",
            click: () => void runLogoutFromMenu(),
          },
          {
            // Without this the user has no way to enter their cookies manually.
            label: "Open Credentials File…",
            click: () => void shell.openPath(CREDENTIALS_FILE),
          },
          {
            label: "Open Data Folder",
            click: () => void shell.openPath(USER_DATA_DIR),
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }] },
    ]),
  );
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
    title: "Toastmasters Tools",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(async () => {
  registerIpcHandlers();
  createMenu();

  // Startup self-heal: re-harvest from the persistent login partition and apply
  // any still-valid cookies to process.env + config.env, so a previous login
  // survives a restart without the user acting. Must run BEFORE the first
  // loadCore() below, while core's env-derived consts are still unfrozen.
  // Requires app.whenReady() (session access), hence its home here. A cold first
  // run has no session yet — the try/catch makes that a no-op.
  try {
    const harvested = await harvestCookies(session.fromPartition(LOGIN_PARTITION).cookies);
    applyCookies(CREDENTIALS_FILE, harvested);
  } catch (err) {
    logger.info("startup self-heal skipped", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Observability: prove at runtime — in the packaged app, where there is no
  // repo root — that core resolved its database inside userData rather than
  // somewhere in the asar.
  const { DEFAULT_DB_PATH } = await loadCore();
  logger.info("startup paths", {
    userData: USER_DATA_DIR,
    database: DEFAULT_DB_PATH,
    credentials: CREDENTIALS_FILE,
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
