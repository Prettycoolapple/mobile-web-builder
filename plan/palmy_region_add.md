# Fix "Unknown zone" for Palmerston North (3 & 5 Rimu Place, Cloverlea)

## Context

**The reported bug is not a code defect. The Manawatu provider is already fully built — it has just never been committed.**

I verified `manawatu` appears **zero times in `HEAD`** across all five provider files, and in **no commit in the repo's history**. It exists only as uncommitted working-tree changes. Production therefore has no Manawatu provider, so:

`resolvePlanningJurisdiction()` → no match → `unsupported` → `partialProviderZone()` sets `zone_code: "UNKNOWN"` → pipeline.ts:1203 sets `merged.zone_code = null` → analyse.ts:1289 renders **"Unknown zone"** → `developmentScoreUnavailableReason()` returns `missing_zone` → **all scores, costs, ROI and strategies are suppressed**, and the site plan gets no regional overlay/service layers.

This is the same pattern as the recorded Rural BoP incident: correct fixes that were never deployed because they stayed uncommitted.

### District/region answer

Both addresses are in **Palmerston North City Council**, region **Manawatū-Whanganui**. Cloverlea is a PNCC suburb. Provider `manawatu` (PNCC + Manawatū District Council), covered by `PALMERSTON_NORTH_BOUNDS`.

### Live verification already performed (all against real council GIS)

| Check | Result |
|---|---|
| Provider routing | `-40.3467, 175.5811` sits inside `PALMERSTON_NORTH_BOUNDS` → `manawatu` ✅ |
| Geocode (Nominatim, as pipeline calls it) | Both addresses return **house-level** points, not road centreline ✅ |
| Zone at geocoded point | `DISTRICTPLAN_PlanningZones` → **`Residential`** for both ✅ |
| Rule pack | `PNCC_RESIDENTIAL`, **350 m² min lot** — Cloverlea correctly excluded from the 500 m² Ashhurst/Bunnythorpe/Longburn locality ✅ |
| Overlays | All 8 PNCC overlay layers queried, **zero hits** — genuinely unconstrained sites, not a failure ✅ |
| Three waters | Water / sewer / stormwater mains **all return features within 500 m** ✅ |
| Cost profile | `manawatu-default`, Auckland assumptions, `source: auckland_default_pending_regional_rates` ✅ |
| ROI | `manawatu` is in `INTERIM_COMPARABLE_ROI_PROVIDERS` **and** `regionalCvExitFallbackAllowed` ✅ |
| Council rates/valuation | 3 Rimu Pl: **967 m², CV $600k, LV $375k**; 5 Rimu Pl: **964 m², CV $550k, LV $375k** (2026/27) ✅ |
| Tests | 104 pass across 6 regional suites ✅ |

At ~965 m² in a 350 m² minimum zone with no overlays, **both sites support a 2-lot subdivision** — they should score, not blank out.

### Requirements already satisfied by the uncommitted code

The user's asks — Auckland cost model applied, future-proofed for later region-specific tuning, ROI section, and dev/cost/ease/ROI scoring — are **already implemented**. `REGIONAL_COST_OVERRIDES.manawatu = {}` is exactly the future-proofing hook: an empty override means "Auckland numbers", and fields get tuned individually later, flipping `source` to `regional_verified`.

**So the fix is primarily a delivery problem, plus two robustness gaps worth closing while we're here.**

---

## ⚠️ Coordination hazard — read first

The uncommitted diff is a **single blended blob** containing both:
- `manawatu` (what we need), and
- `western-bay` (the Codex agent's 481 Pukehina Parade work — also absent from `HEAD`)

Codex's last edit was 19:38; the tree has been quiet since. **Before touching anything, confirm with the user that Codex is finished and has stopped writing.** If Codex is still live, do not edit `regional-arcgis.ts`, `regional-property-history.ts`, `merge.ts`, or `site-plan.ts` — we would clobber each other.

---

## Step 1 — Land the existing provider (the actual fix)

1. Confirm Codex is done. Re-check `find artifacts -name "*.ts" -mmin -15`.
2. Create a branch off `main` (do not commit directly to `main`).
3. Run the full suite: `pnpm --filter @workspace/api-server ci` (typecheck + vitest). `site-plan-regional.test.ts` needs `DATABASE_URL` set — it is imported transitively via `site-plan-layer-cache.ts`; set any valid connection string, it is not queried in that test.
4. Commit the Manawatu + Western Bay provider work together (they are interleaved in the same files and both are complete and green).

This alone fixes zone, scores, cost, ROI and the site plan card for Palmerston North.

## Step 2 — PNCC parcel-level geocoder (robustness)

Nominatim happens to have good coverage on Rimu Place, but relying on OSM for every PN address is fragile — a road-centreline result returns **zero** zone features (I reproduced this exactly). Whakatane and Rotorua already solve this with council address layers; apply the same pattern.

In `artifacts/api-server/src/lib/geocode.ts`:
- Add a third entry to `COUNCIL_ADDRESS_SOURCES` (geocode.ts:97) for PNCC's `PROPERTY_PARCEL_ADDR_VIEW/FeatureServer/0`, matching `/\b(palmerston north|cloverlea|awapuni|highbury|takaro|terrace end|milson|kelvin grove|roslyn|hokowhitu|aokautere|ashhurst|bunnythorpe|longburn|linton)\b/i`.
- `where`: `UPPER(FULLADDRESS) LIKE '<number><suffix> <ROAD> %'`. **Note:** `FULLADDRESS` is uppercase, comma-free, and **unabbreviated** (`5 RIMU PLACE PALMERSTON NORTH`) — do *not* apply the `PLACE`→`PL` abbreviation logic used for Whakatane.
- `formatted`: derive from `FULLADDRESS`.

`councilAddressGeocode()` (geocode.ts:167) currently reads `feature.geometry.x/y`, which is `undefined` for polygon layers. **Extend it** to also set `returnCentroid=true` and fall back to `feature.centroid.x/y`. I verified this returns `{x: 175.5813663, y: -40.3466946}` for 5 Rimu Place. Keep it additive so the two existing point-layer sources are unaffected.

## Step 3 — PNCC valuation as regional property history (robustness)

Today PN falls back to ScrapingBee scrapers for CV and land area. PNCC publishes this directly, which is more reliable and makes rows cacheable via `hasCompleteDirectRegionalCore`.

In `artifacts/api-server/src/lib/regional-property-history.ts`, add a `manawatu` fetcher against `OD_PROPERTY_RATES_VALUATION/FeatureServer/0`, following the existing Whakatane/Western Bay fetchers.

Field mapping — **three parsing traps, all confirmed live**:
- `CURR_CAPITALVALUE` / `CURR_LANDVALUE` are **strings** formatted `"$ 600000"` → strip `$` and whitespace before `Number()`.
- `VAL_AREA` is in **hectares** (`0.0967`) → **×10000** for `land_area_sqm`.
- `LOCATION` casing is inconsistent (`3 Rimu Place` vs `7 RIMU PLACE`) → always match with `UPPER(LOCATION)`.
- `VAL_YEAR` (`"2026/27"`) → `cv_year`; `LEGAL` (`"Lot 28 DP 25094"`) → legal description.

Then add a `manawatu` branch to `cachedRawNeedsRegionalPropertyHistoryRefresh()` in `property-cache-rules.ts` requiring `cv_nzd` and `land_area_sqm`, mirroring the `western-bay` branch.

## Step 4 — Tests

Follow the established patterns exactly (`vi.stubGlobal("fetch", …)` keyed on `url.includes(...)`, `vi.unstubAllGlobals()` in `afterEach`):

- `regional-planning.test.ts` — assert Rimu Place coords → `manawatu`.
- `regional-rules.test.ts` — `Residential` + PNCC label → `PNCC_RESIDENTIAL`, 350 m², `automaticRoiAllowed: true`; assert Cloverlea does **not** match the 500 m² locality pack.
- `regional-property-history.test.ts` — new PNCC fetcher, covering the `"$ 600000"` string and hectares→m² conversion.
- `pipeline-score-gate.test.ts` — a Manawatu 965 m² fixture asserting `ease`/`cost`/`roi` are numbers and `developmentScoreUnavailableReason(...) === null`.
- `geocode` — PNCC source selection + centroid fallback.

## Verification (must all pass before calling this done)

1. `pnpm --filter @workspace/api-server ci` — full typecheck + tests green.
2. `pnpm --filter @workspace/api-server smoke:regional-planning` — picks up `manawatu` automatically from the registry.
3. **End-to-end against the real report** for both `5 Rimu Place, Palmerston North` and `3 Rimu Place, Cloverlea, Palmerston North`, confirming every Property Overview field is populated — specifically **zone reads "Residential …", not "Unknown zone"** — land area ≈965/967 m², CV $550k/$600k, title type resolved.
4. ROI section renders with a cost model and bear/base/bull scenarios; dev score, cost, ease and ROI scores all present.
5. Plan tab → Site Plan card returns **stormwater, wastewater and potable water** service layers, plus the controls/overlay planning group (expected to be an empty overlay set here — that is the correct answer for these parcels, and must be distinguishable from a fetch failure).

## Deployment & cache — answering the final question

**Committing and deploying is sufficient. No manual cache purge is needed.**

The cache self-heals by design. After deploy, `cachedPlanningProviderId()` ignores a stored `unsupported` provider and **recomputes from the stored lat/lng**, now returning `manawatu`. `cachedRawNeedsRegionalZoneRefresh()` then sees a regional provider with a zone layer and a stored `zone_code` of `UNKNOWN`/empty → returns `true` → cache miss → full live re-acquire.

Two further points worth knowing:
- `hasCacheableCore()` (pipeline.ts:502) **refuses to cache** a regional property whose zone is missing or `UNKNOWN`, so a bad PN row was most likely never persisted at all.
- For any non-Auckland provider, `refreshRegionalPlanning` re-fetches zone, overlays and infrastructure **live on every run even on a cache hit** (pipeline.ts:787).

So: commit → deploy → re-analyse. A brand-new search is the cleanest confirmation, but even the history page would re-acquire. Only bump `SCORING_VERSION` if the scoring inputs themselves change — landing this provider does not require it.

**No mobile app build is required** — routes and the mobile `SitePlanCard` are provider-agnostic, and no DB migration is involved.