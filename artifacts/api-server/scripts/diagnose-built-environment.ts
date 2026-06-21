/**
 * One-off diagnostic for the "Built environment section missing" investigation.
 *
 * Walks the exact tiers `fetchBuiltEnvironmentContext` uses for a given address
 * and prints, per tier, what was found / accepted / rejected and the final
 * `knownBuildYearCount`. This tells us whether the section is empty because of
 * address matching (Tier-1 over-rejection) or a data-source/timeout miss.
 *
 * Needs real env (GOOGLE_MAPS_API_KEY for best geocode, LINZ_API_KEY for the
 * Tier-3 parcel fallback). Run from artifacts/api-server with:
 *   pnpm exec tsx scripts/diagnose-built-environment.ts "19 Chatsworth Crescent, Pakuranga"
 *
 * Throwaway — safe to delete after diagnosis.
 */
import "../src/lib/loadEnv";
import { geocodeAddress } from "../src/lib/geocode";
import { fetchLINZAddressCandidates, fetchLINZParcelsNear } from "../src/lib/linz";
import {
  fetchBuiltEnvironmentContext,
  generateNearbyAddressCandidates,
  isAcceptableNearbyAddressMatch,
} from "../src/lib/built-environment-context";

const ADDRESS = process.argv[2] ?? "19 Chatsworth Crescent, Pakuranga";

async function main(): Promise<void> {
  console.log(`\n=== Diagnosing built environment for: ${ADDRESS} ===\n`);
  console.log("env:", {
    GOOGLE_MAPS_API_KEY: Boolean(process.env["GOOGLE_MAPS_API_KEY"]),
    LINZ_API_KEY: Boolean(process.env["LINZ_API_KEY"]),
  });

  const geo = await geocodeAddress(ADDRESS).catch((err) => {
    console.log("geocode ERROR:", (err as Error).message);
    return null;
  });
  console.log("\n[geocode]", geo);
  if (!geo) {
    console.log("Geocode failed → pipeline returns builtEnvironmentContext: null (section hidden).");
    return;
  }
  const subjectAddress = geo.formatted ?? ADDRESS;

  // ---- Tier 1: LINZ-validated nearby addresses ----
  const candidates = generateNearbyAddressCandidates(subjectAddress, 12);
  console.log(`\n[Tier 1] generated ${candidates.length} nearby candidates:`, candidates);
  for (const candidate of candidates.slice(0, 8)) {
    const matches = await fetchLINZAddressCandidates(candidate, { timeoutMs: 8000, maxResults: 5 }).catch(
      () => [] as Awaited<ReturnType<typeof fetchLINZAddressCandidates>>,
    );
    const accepted = matches.find((m) => isAcceptableNearbyAddressMatch(candidate, m.address, subjectAddress));
    console.log(
      `  • ${candidate}\n      LINZ matches: ${matches.map((m) => m.address).join(" | ") || "(none)"}\n      accepted: ${accepted?.address ?? "REJECTED/none"}`,
    );
  }

  // ---- Tier 3: LINZ parcels near coords (needs LINZ_API_KEY) ----
  const parcels = await fetchLINZParcelsNear(geo.lat, geo.lng, 100, 40).catch((err) => {
    console.log("\n[Tier 3] fetchLINZParcelsNear ERROR:", (err as Error).message);
    return null;
  });
  console.log(`\n[Tier 3] LINZ parcels near (${geo.lat}, ${geo.lng}):`, parcels === null ? "null (no key / down)" : `${parcels.length} parcels`);

  // ---- Final assembled context ----
  const context = await fetchBuiltEnvironmentContext({ address: subjectAddress, lat: geo.lat, lng: geo.lng });
  console.log("\n[final context]", {
    assessedProperties: context.assessedProperties,
    knownBuildYearCount: context.knownBuildYearCount,
    signal: context.signal,
    confidence: context.confidence,
    reasons: context.reasons,
  });
  console.log("\nnearbyStatus:", context.nearbyStatus);
  console.log(
    `\n=> Section ${context.knownBuildYearCount > 0 ? "WOULD render" : "is HIDDEN (knownBuildYearCount = 0)"}.`,
  );
}

main().catch((err) => {
  console.error("diagnostic failed:", err);
  process.exit(1);
});
