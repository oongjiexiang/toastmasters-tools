// Importing ./paths loads the monorepo's .env file as a side effect and resolves
// every filesystem anchor from the repo root rather than process.cwd().
import { DATA_DIR, ENV_FILE, REPO_ROOT } from "./paths";

export const CLUB_ID = process.env.CLUB_ID ?? "7232e89a-8cd7-ec11-a2fd-005056875f20";
export const SESSION_ID = process.env.BASECAMP_SESSIONID ?? "";
export const TI_COOKIE = process.env.TI_COOKIE ?? "";
export const BASE_URL = "https://basecamp.toastmasters.org/api/bcm/progress/";

/**
 * Absolute path to the data directory (db.sqlite + membership CSVs).
 * Formerly the relative string "results", which broke once npm workspace scripts
 * started running with the workspace directory as cwd.
 */
export const RESULTS_DIR = DATA_DIR;

export { DATA_DIR, ENV_FILE, REPO_ROOT };
