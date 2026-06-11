/**
 * One-off live verification for the 6 Riddell Road incident fix.
 * Fetches the real listing page meta and runs the deterministic
 * listing-claims extractor on it. Run with:
 *   pnpm exec tsx scripts/verify-riddell-claims.ts
 */
import { extractListingClaims, detectRedevelopmentConflict } from "../src/lib/listing-claims";

const LISTING_URL = "https://www.barfoot.co.nz/property/residential/auckland-city/glendowie/townhouse/935046";

async function main(): Promise<void> {
  const resp = await fetch(LISTING_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
  });
  console.log("HTTP status:", resp.status);
  const html = await resp.text();
  const decode = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const ogTitle = decode(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? "");
  const ogDesc = decode(html.match(/<meta (?:property|name)="(?:og:)?description" content="([^"]+)"/)?.[1] ?? "");
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const propertyTypeOnPage = /Property type:\s*Townhouse/i.test(bodyText) ? "Townhouse" : null;

  console.log("og:title:", ogTitle);
  console.log("og:description:", ogDesc.slice(0, 500));
  console.log("page Property type field:", propertyTypeOnPage);

  const claims = extractListingClaims({
    listingTitle: ogTitle,
    description: `${ogDesc} ${bodyText.slice(0, 4000)}`,
    propertyType: propertyTypeOnPage,
  });
  console.log("\nextractListingClaims:", JSON.stringify(claims, null, 2));

  const conflict = detectRedevelopmentConflict({
    claims,
    councilBuildYear: 1935, // what the stale council/valuation records said
    listingFloorAreaSqm: 210,
    councilFloorAreaSqm: 210,
  });
  console.log("\ndetectRedevelopmentConflict (vs council build_year 1935):", JSON.stringify(conflict, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
