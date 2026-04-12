import { execSync } from "child_process";
import { logger } from "../logger";
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";

let _chromiumPath: string | null = null;

export function getChromiumPath(): string {
  if (_chromiumPath) return _chromiumPath;
  try {
    const path = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (path) {
      _chromiumPath = path;
      return path;
    }
  } catch {
    /* fall through */
  }
  throw new Error("No system Chromium found. Install via nixpkgs.chromium");
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

export async function launchBrowser(): Promise<Browser> {
  const executablePath = getChromiumPath();
  return chromium.launch({ executablePath, headless: true, args: BROWSER_ARGS });
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

const MAX_BROWSERS = 2;
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
