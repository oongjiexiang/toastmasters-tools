import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";
import { dialog } from "electron";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { IPC } from "../src/shared/ipc";

/**
 * Main-process IPC behaviour, tested without a GUI.
 *
 * Electron is mocked at the module boundary, and so is `./core` — the single
 * module through which main reaches @toastmasters/core. Mocking core keeps this
 * suite away from better-sqlite3 and from the user's real database entirely: what
 * is under test here is the *mapping* (QueryResult -> IpcResult, throw ->
 * SERVER_ERROR) and the window's security flags, not SQLite.
 */

const USER_DATA = mkdtempSync(join(tmpdir(), "tm-desktop-ipc-"));

/** Captured from ipcMain.handle(...) as main registers its handlers. */
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

/** Captured from `new BrowserWindow({...})`. */
const windowOptions: Record<string, unknown>[] = [];

let readyResolve: () => void;
const whenReady = new Promise<void>((r) => {
  readyResolve = r;
});

vi.mock("electron", () => ({
  app: {
    setName: vi.fn(),
    getPath: vi.fn(() => USER_DATA),
    whenReady: vi.fn(() => whenReady),
    on: vi.fn(),
    quit: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: never) => {
      handlers.set(channel, handler);
    }),
  },
  dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })) },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((t: unknown) => t) },
  BrowserWindow: class {
    static getAllWindows = () => [];
    webContents = { setWindowOpenHandler: vi.fn() };
    constructor(options: Record<string, unknown>) {
      windowOptions.push(options);
    }
    once = vi.fn();
    show = vi.fn();
    loadURL = vi.fn();
    loadFile = vi.fn();
  },
}));

const listMembers = vi.fn();
const getMemberDetail = vi.fn();
const getDiff = vi.fn();
const runFetch = vi.fn();
const runMembership = vi.fn();
const findLatestMembershipFile = vi.fn();

vi.mock("../src/main/core", () => ({
  listMembers,
  getMemberDetail,
  getDiff,
  runFetch,
  runMembership,
  findLatestMembershipFile,
  RESULTS_DIR: "/fake/results",
  DEFAULT_DB_PATH: "/fake/results/db.sqlite",
}));

/** Invokes a registered IPC handler the way ipcMain would. */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return handler({}, ...args);
}

beforeAll(async () => {
  await import("../src/main/index");
  readyResolve();
  // Let main's whenReady().then(...) chain (registerIpcHandlers, createWindow) run.
  await new Promise((r) => setTimeout(r, 0));
  await whenReady;
  await new Promise((r) => setTimeout(r, 0));
});

// Call history only — implementations set per test survive. The captured
// `handlers` / `windowOptions` are populated in beforeAll and are unaffected.
beforeEach(() => vi.clearAllMocks());

describe("main registers the IPC surface", () => {
  it("registers exactly the six documented channels", () => {
    expect([...handlers.keys()].sort()).toEqual(Object.values(IPC).sort());
  });

  it("registers no channel outside the shared IPC contract", () => {
    const declared = new Set<string>(Object.values(IPC));
    const undeclared = [...handlers.keys()].filter((c) => !declared.has(c));
    expect(undeclared).toEqual([]);
  });
});

describe("main maps QueryResult onto the IPC envelope", () => {
  it("passes a successful listMembers result through as ok", async () => {
    const members = [{ email: "alice@example.com", name: "Alice Smith", title: "PM1", pathways: [] }];
    listMembers.mockReturnValue({ ok: true, data: members });

    const result = await invoke(IPC.LIST_MEMBERS);

    expect(result).toEqual({ ok: true, data: members });
  });

  it("maps a SNAPSHOT_MISSING failure onto an ok:false envelope, preserving code and message", async () => {
    listMembers.mockReturnValue({
      ok: false,
      code: "SNAPSHOT_MISSING",
      message: "Run npm run fetch and npm run membership first.",
    });

    const result = await invoke(IPC.LIST_MEMBERS);

    expect(result).toEqual({
      ok: false,
      code: "SNAPSHOT_MISSING",
      message: "Run npm run fetch and npm run membership first.",
    });
  });

  it("maps a NOT_FOUND failure from getMemberDetail onto an ok:false envelope", async () => {
    getMemberDetail.mockReturnValue({
      ok: false,
      code: "NOT_FOUND",
      message: "Member not found.",
    });

    const result = await invoke(IPC.GET_MEMBER, "nobody@example.com", "Presentation Mastery");

    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Member not found.",
    });
  });

  it("forwards email and pathway to getMemberDetail", async () => {
    getMemberDetail.mockReturnValue({ ok: true, data: { levels: [] } });

    await invoke(IPC.GET_MEMBER, "alice@example.com", "Presentation Mastery");

    expect(getMemberDetail).toHaveBeenCalledWith(
      "alice@example.com",
      "Presentation Mastery",
    );
  });

  it("maps a diff failure onto an ok:false envelope", async () => {
    getDiff.mockReturnValue({ ok: false, code: "SNAPSHOT_MISSING", message: "no snapshots" });

    const result = await invoke(IPC.GET_DIFF);

    expect(result).toMatchObject({ ok: false, code: "SNAPSHOT_MISSING" });
  });
});

describe("main turns unexpected failures into SERVER_ERROR rather than crashing", () => {
  it("returns SERVER_ERROR with the thrown message when a query throws", async () => {
    listMembers.mockImplementation(() => {
      throw new Error("database is locked");
    });

    const result = await invoke(IPC.LIST_MEMBERS);

    expect(result).toEqual({
      ok: false,
      code: "SERVER_ERROR",
      message: "database is locked",
    });
  });

  it("returns SERVER_ERROR when a refresh scraper rejects", async () => {
    runFetch.mockRejectedValue(new Error("BASECAMP_SESSIONID is not set"));

    const result = await invoke(IPC.REFRESH_PROGRESS);

    expect(result).toEqual({
      ok: false,
      code: "SERVER_ERROR",
      message: "BASECAMP_SESSIONID is not set",
    });
  });

  it("rejects a missing email argument instead of querying with undefined", async () => {
    getMemberDetail.mockReturnValue({ ok: true, data: {} });

    const result = await invoke(IPC.GET_MEMBER, undefined, "Presentation Mastery");

    expect(result).toMatchObject({ ok: false, code: "SERVER_ERROR" });
    expect(getMemberDetail).not.toHaveBeenCalled();
  });

  it("rejects an empty pathway argument", async () => {
    getMemberDetail.mockReturnValue({ ok: true, data: {} });

    const result = await invoke(IPC.GET_MEMBER, "alice@example.com", "");

    expect(result).toMatchObject({ ok: false, code: "SERVER_ERROR" });
    expect(getMemberDetail).not.toHaveBeenCalled();
  });
});

describe("main runs the refresh scrapers", () => {
  it("reports ok after a successful progress refresh", async () => {
    runFetch.mockResolvedValue(undefined);

    const result = await invoke(IPC.REFRESH_PROGRESS);

    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, data: null });
  });

  it("reports ok after a successful membership refresh", async () => {
    runMembership.mockResolvedValue(undefined);

    const result = await invoke(IPC.REFRESH_MEMBERSHIP);

    expect(runMembership).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, data: null });
  });

  it("returns data:null when the user cancels the CSV save dialog", async () => {
    findLatestMembershipFile.mockReturnValue("/fake/results/membership-2026-07-01.csv");

    const result = await invoke(IPC.DOWNLOAD_MEMBERSHIP_CSV);

    expect(result).toEqual({ ok: true, data: null });
  });

  it("copies the latest membership file to the chosen path and returns it when the user confirms", async () => {
    // A real source file so the copy actually happens — this is the download's
    // whole point, and the cancel/error tests never exercise it.
    const dir = mkdtempSync(join(tmpdir(), "tm-desktop-csv-"));
    const source = join(dir, "membership-2026-07-01.csv");
    const destination = join(dir, "saved-membership.csv");
    writeFileSync(source, "email,name\nalice@example.com,Alice Smith\n");

    findLatestMembershipFile.mockReturnValue(source);
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: destination,
    });

    const result = await invoke(IPC.DOWNLOAD_MEMBERSHIP_CSV);

    expect(result).toEqual({ ok: true, data: destination });
    expect(readFileSync(destination, "utf8")).toBe(readFileSync(source, "utf8"));
  });

  it("returns SERVER_ERROR when no membership file exists to download", async () => {
    findLatestMembershipFile.mockImplementation(() => {
      throw new Error("No membership file found");
    });

    const result = await invoke(IPC.DOWNLOAD_MEMBERSHIP_CSV);

    expect(result).toEqual({
      ok: false,
      code: "SERVER_ERROR",
      message: "No membership file found",
    });
  });
});

describe("renderer window security invariants (roadmap Phase 11)", () => {
  it("creates a browser window", () => {
    expect(windowOptions).toHaveLength(1);
  });

  it("disables nodeIntegration", () => {
    const webPreferences = windowOptions[0].webPreferences as Record<string, unknown>;
    expect(webPreferences.nodeIntegration).toBe(false);
  });

  it("enables contextIsolation", () => {
    const webPreferences = windowOptions[0].webPreferences as Record<string, unknown>;
    expect(webPreferences.contextIsolation).toBe(true);
  });

  it("enables the renderer sandbox", () => {
    const webPreferences = windowOptions[0].webPreferences as Record<string, unknown>;
    expect(webPreferences.sandbox).toBe(true);
  });

  it("loads the renderer through a preload script — the only bridge into Node", () => {
    const webPreferences = windowOptions[0].webPreferences as Record<string, unknown>;
    expect(webPreferences.preload).toMatch(/preload[\\/]index\.js$/);
  });
});

describe("main points core's data directory at Electron userData", () => {
  it("sets TOASTMASTERS_DATA_DIR before core can be evaluated", () => {
    expect(process.env.TOASTMASTERS_DATA_DIR).toBe(USER_DATA);
  });
});
