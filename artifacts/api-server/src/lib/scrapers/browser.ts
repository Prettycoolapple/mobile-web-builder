/// <reference lib="dom" />
import fs from "node:fs";
import { execSync } from "child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { logger } from "../logger";
import type { Browser, Page, BrowserContext } from "playwright";

let _chromiumPath: string | null = null;

/** Vercel bundles omit node_modules for externalized deps; never touch Playwright there. */
export function isVercelServerless(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL === "true";
}

let _playwrightRequire: NodeRequire | null = null;

function requirePlaywright(): typeof import("playwright") {
  if (isVercelServerless()) {
    throw new Error(
      "Browser automation (Playwright) is not available on Vercel serverless. Use a long-running host for full scrapers or ScrapingBee-only flows.",
    );
  }
  if (!_playwrightRequire) {
    _playwrightRequire = createRequire(path.join(process.cwd(), "package.json"));
  }
  return _playwrightRequire("playwright") as typeof import("playwright");
}

function firstPathFromCommandOutput(output: string): string | null {
  const candidates = output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? null;
}

function tryCommand(command: string): string | null {
  try {
    const output = execSync(command, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output ? firstPathFromCommandOutput(output) : null;
  } catch {
    return null;
  }
}

function getPathFromEnv(): string | null {
  const explicit =
    process.env["PLAYWRIGHT_CHROMIUM_PATH"] ??
    process.env["CHROMIUM_PATH"] ??
    null;
  if (!explicit) return null;

  const normalized = explicit.trim().replace(/^"|"$/g, "");
  if (!normalized) return null;
  if (!fs.existsSync(normalized)) {
    logger.warn({ configuredPath: normalized }, "Configured Chromium path does not exist");
    return null;
  }
  return normalized;
}

function getBundledPlaywrightPath(): string | null {
  if (isVercelServerless()) return null;
  try {
    const { chromium } = requirePlaywright();
    const bundled = chromium.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // Playwright browser bundle may not be installed on this host.
  }
  return null;
}

function getSystemChromiumPath(): string | null {
  const commands = process.platform === "win32"
    ? ["where chromium", "where chromium-browser", "where chrome", "where msedge"]
    : ["which chromium", "which chromium-browser", "which google-chrome", "which google-chrome-stable"];

  for (const command of commands) {
    const resolved = tryCommand(command);
    if (resolved) return resolved;
  }
  return null;
}

export function getChromiumPath(): string {
  if (_chromiumPath) return _chromiumPath;

  const envPath = getPathFromEnv();
  if (envPath) {
    _chromiumPath = envPath;
    logger.info({ chromiumPath: _chromiumPath, source: "env" }, "Resolved Chromium executable");
    return _chromiumPath;
  }

  const bundledPath = getBundledPlaywrightPath();
  if (bundledPath) {
    _chromiumPath = bundledPath;
    logger.info({ chromiumPath: _chromiumPath, source: "playwright" }, "Resolved Chromium executable");
    return _chromiumPath;
  }

  const systemPath = getSystemChromiumPath();
  if (systemPath) {
    _chromiumPath = systemPath;
    logger.info({ chromiumPath: _chromiumPath, source: "system" }, "Resolved Chromium executable");
    return _chromiumPath;
  }

  throw new Error(
    "Unable to resolve Chromium executable. Install Playwright browsers (npx playwright install chromium), install a system Chrome/Chromium, or set PLAYWRIGHT_CHROMIUM_PATH.",
  );
}

export const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--window-size=1280,900",
];

const STEALTH_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Startup diagnostic ─────────────────────────────────────────────────────
// Eagerly resolve Chromium at import time so operators see immediately whether
// browser-based scrapers will work. If it fails, all 4 scrapers (Hougarden,
// OneRoof, QV, Homes) will return null data — this is the #1 cause of missing
// CV/build-year after a migration.
let _startupChromiumOk = false;
try {
  const p = getChromiumPath();
  _startupChromiumOk = true;
  logger.info({ chromiumPath: p }, "Browser startup check: Chromium resolved OK — scrapers will use this executable");
} catch (err) {
  logger.error(
    { err: (err as Error).message },
    "Browser startup check: Chromium NOT found — ALL browser-based scrapers (Hougarden, OneRoof, QV, Homes) will FAIL. " +
      "Run `npx playwright install chromium` or set PLAYWRIGHT_CHROMIUM_PATH in .env",
  );
}
export { _startupChromiumOk as chromiumAvailable };

export async function launchBrowser(): Promise<Browser> {
  const { chromium } = requirePlaywright();
  const executablePath = getChromiumPath();
  try {
    return await chromium.launch({ executablePath, headless: true, args: BROWSER_ARGS });
  } catch (err) {
    logger.error(
      { err: (err as Error).message, executablePath },
      "Failed to launch Chromium browser — scraper will return null data",
    );
    throw err;
  }
}

export async function newStealthPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    userAgent: STEALTH_UA,
    viewport: { width: 1280, height: 900 },
    locale: "en-NZ",
    timezoneId: "Pacific/Auckland",
    extraHTTPHeaders: {
      "Accept-Language": "en-NZ,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
    },
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const fakePlugins = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
        ];
        return Object.assign(fakePlugins, { length: 3, item: (i: number) => fakePlugins[i], namedItem: (n: string) => fakePlugins.find(p => p.name === n) || null, refresh: () => {} });
      },
    });
    Object.defineProperty(navigator, "languages", { get: () => ["en-NZ", "en-US", "en"] });
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
    Object.defineProperty(screen, "colorDepth", { get: () => 24 });

    (window as any).chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" }, RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" } },
      runtime: { OnInstalledReason: {}, PlatformArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {} },
    };

    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    (window.navigator.permissions as any).query = (parameters: any) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });

  return { context, page };
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const randomDelay = (min = 1000, max = 3000) =>
  delay(Math.floor(Math.random() * (max - min) + min));

const MAX_BROWSERS = 3;
let activeBrowsers = 0;

export async function withBrowserSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (activeBrowsers >= MAX_BROWSERS) {
    await delay(500);
  }
  activeBrowsers++;
  try {
    return await fn();
  } finally {
    activeBrowsers--;
  }
}

export function logScrapeAttempt(scraper: string, method: string, success: boolean, detail?: string) {
  if (success) {
    logger.info({ scraper, method }, `${scraper}: ${method} succeeded${detail ? " — " + detail : ""}`);
  } else {
    logger.warn({ scraper, method }, `${scraper}: ${method} failed${detail ? " — " + detail : ""}`);
  }
}
