import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { copyFileSync } from "fs";
import { basename, join } from "path";
import { IPC, type IpcResult } from "../shared/ipc";
import {
  credentialsFile,
  ensureCredentialsFile,
  loadCredentials,
} from "./credentials";

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
 * Next.js routes always answer with `{ data }` or `{ error: { code, message } }`.
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

/** Maps core's transport-agnostic QueryResult onto the IPC envelope. */
function fromQuery<T>(
  result:
    | { ok: true; data: T }
    | { ok: false; code: string; message: string },
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

  handle(IPC.REFRESH_PROGRESS, async (core) => {
    await core.runFetch();
    return { ok: true, data: null };
  });

  handle(IPC.REFRESH_MEMBERSHIP, async (core) => {
    await core.runMembership();
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
}

// ── Window & menu ────────────────────────────────────────────────────────────

function createMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          {
            // Without this the user has no way to enter their cookies.
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

  // Observability: prove at runtime — in the packaged app, where there is no
  // repo root — that core resolved its database inside userData rather than
  // somewhere in the asar.
  const { DEFAULT_DB_PATH } = await loadCore();
  console.log(`[toastmasters] userData:    ${USER_DATA_DIR}`);
  console.log(`[toastmasters] database:    ${DEFAULT_DB_PATH}`);
  console.log(`[toastmasters] credentials: ${CREDENTIALS_FILE}`);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
