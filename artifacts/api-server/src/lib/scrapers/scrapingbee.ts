import { logger } from "../logger";

const SCRAPINGBEE_URL = "https://app.scrapingbee.com/api/v1/";
let warnedMissingApiKey = false;

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

  try {
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

    logger.debug({ url: targetUrl }, "ScrapingBee: fetching");
    const response = await fetch(`${SCRAPINGBEE_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const hint =
        response.status === 401 || response.status === 403
          ? " (check SCRAPINGBEE_API_KEY)"
          : response.status === 402 || response.status === 429
            ? " (quota / billing — ScrapingBee dashboard)"
            : "";
      logger.warn(
        { status: response.status, body: body.slice(0, 240), hint },
        `ScrapingBee: HTTP error${hint}`,
      );
      return null;
    }

    const html = await response.text();
    logger.debug({ length: html.length }, "ScrapingBee: HTML received");
    return html;
  } catch (err) {
    logger.warn({ err }, "ScrapingBee: fetch failed");
    return null;
  }
}
