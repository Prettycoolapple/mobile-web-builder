/**
 * Live smoke test for the Rubin integration. Hits the real solver, so it is a
 * script rather than part of `vitest run` — it costs real upstream calls and a
 * cold parcel can take minutes.
 *
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/smoke-rubin.ts
 *
 * Checks the three answers the UI has to tell apart: a supported Auckland site,
 * an address outside Auckland (404), and a non-residential zone (422).
 */

import { fetchRubinScenario, fetchRubinSite, RubinError } from "../lib/rubin";

const SUPPORTED = "10 Speight Road, Kohimarama";
const OUT_OF_AREA = "120 Oriental Parade, Wellington";
const WRONG_ZONE = "1 Queen Street, Auckland";

function seconds(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

async function siteCheck(label: string, address: string) {
  const startedAt = Date.now();
  try {
    const result = await fetchRubinSite({ address });
    console.log(
      `  ${label.padEnd(12)} ${seconds(startedAt).padStart(7)}  supported=${result.subdivisionSupported}` +
        `  zone="${result.site.zone}"  area=${result.site.areaM2}m²  parcel=${result.site.parcelId}`,
    );
  } catch (err) {
    const e = err as RubinError;
    console.log(`  ${label.padEnd(12)} ${seconds(startedAt).padStart(7)}  kind=${e.kind} status=${e.status}  "${e.message}"`);
  }
}

async function main() {
  console.log("\n/api/v1/site — the gating lookup");
  await siteCheck("supported", SUPPORTED);
  await siteCheck("out-of-area", OUT_OF_AREA);
  await siteCheck("wrong-zone", WRONG_ZONE);

  console.log("\n/api/v1/subdivide — two scenarios, fired in parallel");
  const startedAt = Date.now();
  const [maxYield, highEnd] = await Promise.all([
    fetchRubinScenario({ address: SUPPORTED, scenario: "max-yield" }),
    fetchRubinScenario({ address: SUPPORTED, scenario: "high-end" }),
  ]);
  console.log(`  wall clock for BOTH: ${seconds(startedAt)}`);
  for (const response of [maxYield, highEnd]) {
    const scenario = response.scenarios[0];
    if (!scenario) {
      console.log("  (no viable layout returned)");
      continue;
    }
    const footprint = scenario.lots.reduce((sum, lot) => sum + lot.footprintM2, 0);
    console.log(
      `  ${scenario.id.padEnd(10)} "${scenario.label}"  lots=${scenario.lotCount}` +
        `  building=${footprint}m²  driveway=${scenario.drivewayAreaM2}m²  cached=${scenario.cached}`,
    );
    // The client draws these straight onto the map, so a null boundary or a
    // non-WGS84 coordinate would be an invisible, wrong-looking failure.
    for (const lot of scenario.lots) {
      const ring = lot.boundary?.coordinates?.[0];
      if (!ring?.length) throw new Error(`${scenario.id}/${lot.id}: missing boundary ring`);
      const [lng, lat] = ring[0]!;
      if (lng < 172 || lng > 176 || lat < -38 || lat > -36) {
        throw new Error(`${scenario.id}/${lot.id}: [${lng}, ${lat}] is not WGS84 lng/lat over Auckland`);
      }
    }
  }
  console.log(`  solverVersion=${maxYield.solverVersion}  cacheEnabled=${maxYield.cacheEnabled}`);
  console.log("\nAll boundaries are WGS84 [lng, lat] over Auckland.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
