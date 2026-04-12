import { execSync } from "child_process";
import { logger } from "../logger";

let _chromiumPath: string | null = null;

export function getChromiumPath(): string {
  if (_chromiumPath) return _chromiumPath;
  try {
    const path = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (path) {
      logger.debug({ path }, "System Chromium found");
      _chromiumPath = path;
      return path;
    }
  } catch {
    logger.warn("System Chromium not found via which");
  }
  throw new Error("No system Chromium found. Install via: nix-env -iA nixpkgs.chromium");
}

export const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];
