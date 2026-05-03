import { logger } from "../logger";

const SCRAPINGBEE_URL = "https://app.scrapingbee.com/api/v1/";
let warnedMissingApiKey = false;

export async function fetchWithScrapingBee(
  targetUrl: string,
  options: { render_js?: boolean; premium_proxy?: boolean; wait?: number } = {},
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
      country_code: "nz",
      block_ads: "true",
      block_resources: "false",
      wait: String(options.wait ?? 2000),
    });

    logger.debug({ url: targetUrl }, "ScrapingBee: fetching");
    const response = await fetch(`${SCRAPINGBEE_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn({ status: response.status, body: body.slice(0, 200) }, "ScrapingBee: HTTP error");
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
