import { logger } from "../logger";

const SCRAPINGBEE_URL = "https://app.scrapingbee.com/api/v1/";
let warnedMissingApiKey = false;

// ─── Global ScrapingBee concurrency queue ────────────────────────────────────
// ScrapingBee plans cap the number of *concurrent* requests (low tiers allow as
// few as 2). When several users run feasibility analyses at once we can easily
// exceed that and get HTTP 429s, so every ScrapingBee call is funnelled through
// a fair FIFO semaphore: at most SCRAPINGBEE_MAX_CONCURRENCY run at a time and
// the rest wait their turn. Requests that hit a transient error (429 / 5xx /
// network) are retried with exponential backoff so callers still get a result.
//
// To grow with your plan, just raise SCRAPINGBEE_MAX_CONCURRENCY — the queue,
// retry and fairness logic stay exactly the same.
//
// NOTE: this limiter is per Node process. It enforces the cap correctly for a
// single long-running server instance (the normal deployment for this API). If
// you ever scale to multiple instances / serverless lambdas, move the semaphore
// to a shared store (e.g. Redis) so the global cap is still honoured.
const MAX_CONCURRENCY = Math.max(1, Number(process.env["SCRAPINGBEE_MAX_CONCURRENCY"] ?? 2) || 2);
// How long a request will wait in the queue for a free slot before giving up
// (returns null → callers gracefully fall back to other data sources).
const MAX_QUEUE_WAIT_MS = Math.max(5_000, Number(process.env["SCRAPINGBEE_MAX_QUEUE_WAIT_MS"] ?? 90_000) || 90_000);
// Retries for a transient failure (on top of the first attempt).
const MAX_RETRIES = Math.max(0, Number(process.env["SCRAPINGBEE_MAX_RETRIES"] ?? 3) || 0);
const REQUEST_TIMEOUT_MS = Math.max(10_000, Number(process.env["SCRAPINGBEE_REQUEST_TIMEOUT_MS"] ?? 35_000) || 35_000);
// Base unit for exponential backoff between retries (429 uses 3×).
const RETRY_BASE_MS = Math.max(50, Number(process.env["SCRAPINGBEE_RETRY_BASE_MS"] ?? 1000) || 1000);

interface Waiter {
  /** Grant the freed slot to this waiter. */
  grant: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let activeCount = 0;
const waitQueue: Waiter[] = [];

/** Acquire one concurrency slot, waiting in FIFO order. Rejects if no slot frees
 *  up within maxWaitMs so a request never hangs forever under sustained load. */
function acquireSlot(maxWaitMs: number): Promise<void> {
  if (activeCount < MAX_CONCURRENCY) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      grant: () => {
        activeCount++;
        resolve();
      },
      reject,
      timer: setTimeout(() => {
        const idx = waitQueue.indexOf(waiter);
        if (idx >= 0) waitQueue.splice(idx, 1);
        reject(new Error(`queue wait exceeded ${maxWaitMs}ms`));
      }, maxWaitMs),
    };
    waitQueue.push(waiter);
    logger.debug(
      { active: activeCount, queued: waitQueue.length, max: MAX_CONCURRENCY },
      "ScrapingBee: no free slot — request queued",
    );
  });
}

/** Release a held slot, handing it directly to the next waiter (preserves FIFO
 *  fairness and keeps activeCount === in-flight + granted). */
function releaseSlot(): void {
  activeCount = Math.max(0, activeCount - 1);
  const next = waitQueue.shift();
  if (next) {
    clearTimeout(next.timer);
    next.grant();
  }
}

/** Snapshot of the queue, for observability/health endpoints. */
export function getScrapingBeeQueueStats(): { active: number; queued: number; maxConcurrency: number } {
  return { active: activeCount, queued: waitQueue.length, maxConcurrency: MAX_CONCURRENCY };
}

function isRetryableStatus(status: number): boolean {
  // 429 = concurrency / rate limit, 408 = request timeout, 5xx = transient.
  // 401/403 (auth) and 402 (billing/quota) are NOT retryable — retrying wastes
  // the quota and will keep failing.
  return status === 429 || status === 408 || status >= 500;
}

type FetchOutcome =
  | { html: string }
  | { error: "retryable" | "non_retryable"; status: number | null };

async function performScrapingBeeFetch(
  apiKey: string,
  targetUrl: string,
  options: {
    render_js?: boolean;
    premium_proxy?: boolean;
    wait?: number;
    wait_for?: string;
    js_scenario?: unknown;
    stealth_proxy?: boolean;
  },
): Promise<FetchOutcome> {
  const params = new URLSearchParams({
    api_key: apiKey,
    url: targetUrl,
    render_js: String(options.render_js ?? true),
    premium_proxy: String(options.premium_proxy ?? false),
    stealth_proxy: String(options.stealth_proxy ?? false),
    country_code: "nz",
    block_ads: "true",
    block_resources: "false",
    wait: String(options.wait ?? 2000),
  });
  if (options.wait_for) params.set("wait_for", options.wait_for);
  if (options.js_scenario) {
    params.set(
      "js_scenario",
      typeof options.js_scenario === "string" ? options.js_scenario : JSON.stringify(options.js_scenario),
    );
  }

  try {
    const response = await fetch(`${SCRAPINGBEE_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const retryable = isRetryableStatus(response.status);
      const hint =
        response.status === 401 || response.status === 403
          ? " (check SCRAPINGBEE_API_KEY)"
          : response.status === 402
            ? " (quota / billing — ScrapingBee dashboard)"
            : response.status === 429
              ? " (concurrency / rate limit — will retry)"
              : "";
      logger.warn(
        { status: response.status, body: body.slice(0, 240), retryable, hint },
        `ScrapingBee: HTTP error${hint}`,
      );
      return { error: retryable ? "retryable" : "non_retryable", status: response.status };
    }

    const html = await response.text();
    logger.debug({ length: html.length }, "ScrapingBee: HTML received");
    return { html };
  } catch (err) {
    // Network failure / timeout — transient, worth a retry.
    logger.warn({ err: (err as Error).message }, "ScrapingBee: fetch failed (network/timeout) — retryable");
    return { error: "retryable", status: null };
  }
}

export async function fetchWithScrapingBee(
  targetUrl: string,
  options: {
    render_js?: boolean;
    premium_proxy?: boolean;
    wait?: number;
    wait_for?: string;
    js_scenario?: unknown;
    stealth_proxy?: boolean;
  } = {},
): Promise<string | null> {
  const apiKey = process.env["SCRAPINGBEE_API_KEY"];
  if (!apiKey) {
    if (!warnedMissingApiKey) {
      warnedMissingApiKey = true;
      logger.warn("ScrapingBee: SCRAPINGBEE_API_KEY not set — ScrapingBee fallback is disabled");
    }
    return null;
  }

  // Wait (FIFO) for a free concurrency slot so we never exceed the plan limit.
  const queuedBehind = waitQueue.length;
  try {
    await acquireSlot(MAX_QUEUE_WAIT_MS);
  } catch (err) {
    logger.warn(
      { url: targetUrl, err: (err as Error).message, queuedBehind },
      "ScrapingBee: gave up waiting for a free concurrency slot — falling back",
    );
    return null;
  }

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt === 0) {
        logger.debug({ url: targetUrl }, "ScrapingBee: fetching");
      }
      const outcome = await performScrapingBeeFetch(apiKey, targetUrl, options);

      if ("html" in outcome) {
        if (attempt > 0) {
          logger.info({ url: targetUrl, attempt }, "ScrapingBee: succeeded after retry");
        }
        return outcome.html;
      }

      // Stop immediately on non-retryable errors or after exhausting retries.
      if (outcome.error === "non_retryable" || attempt === MAX_RETRIES) {
        return null;
      }

      // Exponential backoff with jitter; longer base for 429 (concurrency/rate).
      const base = outcome.status === 429 ? RETRY_BASE_MS * 3 : RETRY_BASE_MS;
      const backoffMs = base * 2 ** attempt + Math.floor(Math.random() * 500);
      logger.info(
        { url: targetUrl, nextAttempt: attempt + 1, backoffMs, status: outcome.status },
        "ScrapingBee: transient failure — backing off before retry",
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
    return null;
  } finally {
    releaseSlot();
  }
}
