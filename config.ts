import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env file if present (manual parse — no external dependency needed)
function loadEnv(): void {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file not found — rely on environment variables
  }
}

loadEnv();

export const CLUB_ID = process.env.CLUB_ID ?? "7232e89a-8cd7-ec11-a2fd-005056875f20";
export const SESSION_ID = process.env.BASECAMP_SESSIONID ?? "";
export const TI_COOKIE = process.env.TI_COOKIE ?? "";
export const RESULTS_DIR = "results";
export const BASE_URL = "https://basecamp.toastmasters.org/api/bcm/progress/";
