# Add a Wairarapa regional planning provider (Masterton / Carterton / South Wairarapa)

## Context

A user analysed **78 Opaki Road, Lansdowne, Masterton** and the feasibility report shows
**"Unknown zone"**, no ROI section, and no dev scoring (cost/ease/ROI); the Plan-tab
**Site plan** card shows no three-waters or overlays.

Root cause (verified in code + against the live report data model): Masterton is in the
**Wairarapa**, which the codebase deliberately excludes from the `wellington` provider
(`WELLINGTON_BOUNDS` comment, [regional-planning.ts:164](artifacts/api-server/src/lib/regional-planning.ts:164)).
Masterton's coordinates (~-40.95, 175.66) fall east of every provider's bounds
(`WELLINGTON_BOUNDS.maxLng = 175.35`) and match no address hint, so
`resolvePlanningJurisdiction` returns the **`unsupported`** provider →
`partialProviderZone` returns `zone_code: "UNKNOWN"`. Downstream this cascades:

- `zone_code` becomes `null` in the pipeline → `developmentScoreUnavailableReason` returns
  `"missing_zone"` → **all three sub-scores, costs, and ROI scenarios are suppressed**
  ([pipeline.ts:1197-1206](artifacts/api-server/src/lib/pipeline.ts:1197), score gate ~1838-1849;
  the mobile `missing_zone` copy is [FeasibilityReport.tsx:644](artifacts/mobile/components/FeasibilityReport.tsx:644)).
- Site plan (`buildNationalSitePlanForGeo`) asks for `unsupported` overlays/services →
  both registries return `[]` → the card silently renders only parcel boundaries + LINZ
  contours over the aerial ([site-plan.ts:1234-1277](artifacts/api-server/src/lib/site-plan.ts:1234)).

**The mobile client is fully data-driven — no client changes are needed.** Fixing all three
asks (ROI+cost modelling, real zone, site-plan three-waters/overlays) is entirely a matter of
registering a new **regional planning provider** for the Wairarapa. Every downstream system
(cost estimator, ROI calculator, scoring, dev strategies, site plan) is already
region-parameterised off `PlanningProviderId`.

**Decision (confirmed with user):** register a single **`wairarapa`** provider covering all
three Wairarapa territorial authorities (Masterton, Carterton, South Wairarapa — they share
the **Wairarapa Combined District Plan**), and seed **indicative** subdivision rule packs with
"confirm against the operative plan" caveats (mirrors the existing Wellington-region packs),
so modelled multi-lot yield + ROI + full dev scoring surface immediately.

**Cost modelling stays seeded from Auckland in an isolated, editable module** (empty override
`{}` == Auckland numbers verbatim), per the user's "future-proof so I can edit later" ask.

## Verified government data sources (Masterton DC ArcGIS, shared across the 3 Wairarapa councils)

Root: `https://gis.mstn.govt.nz/arcgis/rest/services` (public ArcGIS REST — same pattern the
codebase already consumes). All confirmed live via `?f=pjson` during planning.

- **Zoning (region-wide, combined plan):** `ResourceManagementAndPlanning/Zones/MapServer`
  — layers by zone type: `0` Conservation Management, `1` Special Rural, `2` Commercial,
  `3` Industrial, `4` Residential, `5` Primary Production. Attribute fields include
  `ZONE_TYPE`, `SUB_TYPE`, `NAME`, `TLA`, `LOCATION` (use `ZONE_TYPE` as code; `SUB_TYPE`/`NAME`
  as name fields). Multi-layer pattern → mirror Whangarei/Southland `zone(...)` entries.
- **Overlays & controls (region-wide):** `ResourceManagementAndPlanning/ManagementAreas/MapServer`,
  `ResourceManagementAndPlanning/SpecialFeatures/MapServer`, plus hazards
  `EmergencyManagementAndHazards/{FloodZones, EarthquakeHazards, Liquefaction, TsunamiEvacuationZones}/MapServer`.
  (Enumerate each MapServer's sub-layer IDs via `?f=pjson` at implementation — same as every
  other provider was built.)
- **Three waters:** `Services/WaterPublic/MapServer`, `Services/SewerPublic/MapServer`,
  `Services/StormwaterPublic/MapServer`. Layers are grouped by council; **confirmed Masterton
  leaf layer IDs**: Water Main `5`; Sewer Main `4`; Stormwater Main `6`, Watercourse `5`.
  Carterton leaves also present (Water Main `12`/Lateral `11`/Rider `62`; Sewer Main `10`/Lateral `9`;
  Stormwater Main `13`/Lateral `12`). **South Wairarapa three-waters is NOT on this host** — it
  lives on Wellington Water (`gis.wellingtonwater.co.nz/.../Councils/SWDC_3_Waters_Underground_Services2/MapServer`);
  see follow-up note below.

## Approach — new `wairarapa` provider

All changes are backend. Follow the existing **Wellington** provider as the "full yield + ROI"
template and **Whangarei/Southland** as the multi-zone-layer template.

### 1. Provider identity + resolver — `artifacts/api-server/src/lib/regional-planning.ts`
- Add `"wairarapa"` to the `PlanningProviderId` union ([:8-22](artifacts/api-server/src/lib/regional-planning.ts:8)).
- Add `WAIRARAPA_BOUNDS` covering the three districts, e.g.
  `{ minLat: -41.45, maxLat: -40.55, minLng: 175.15, maxLng: 176.30 }` (excludes the Hutt
  Valley at <175.1; refine at implementation). Add a `provider("wairarapa", "Wairarapa combined
  planning provider", null, "Wellington", "partial", "Wairarapa Combined District Plan",
  [...endpointRefs...], supports)` entry to `providerRegistry`, **inserted before the
  `wellington` entry** so Wairarapa wins the small SW-corner overlap (Featherston lng ~175.32
  sits inside `WELLINGTON_BOUNDS` but is South Wairarapa). `supports = supportsAny(ctx,
  WAIRARAPA_BOUNDS, [/\bwairarapa\b/, /\bmasterton\b/, /\blansdowne\b/, /\bkuripuni\b/, /\bsolway\b/,
  /\bopaki\b/, /\bcarterton\b/, /\bgreytown\b/, /\bfeatherston\b/, /\bmartinborough\b/, /\bcerton\b/])`.
- `endpointRefs`: the MDC zoning, hazard, and three-waters services above (for the admin
  smoke-test enumerator).

### 2. Cost profile (Auckland-seeded, editable) — `artifacts/api-server/src/lib/regional-cost-profiles.ts`
- Add `"wairarapa-default"` to `CostProfileId` ([:3-17](artifacts/api-server/src/lib/regional-cost-profiles.ts:3)).
- Add a `wairarapa` row to `PROVIDER_PROFILE_META` ([:213-228](artifacts/api-server/src/lib/regional-cost-profiles.ts:213)) — **compile-forced** (this Record is total).
- Add `wairarapa: {}` to `REGIONAL_COST_OVERRIDES` ([:194-211](artifacts/api-server/src/lib/regional-cost-profiles.ts:194)) — the isolated,
  editable module; empty `{}` deep-merges to Auckland numbers verbatim (the "edit later" hook).

### 3. Zone + overlay ArcGIS config — `artifacts/api-server/src/lib/regional-arcgis.ts`
- Add a `wairarapa` entry to `CONFIGS` ([:107](artifacts/api-server/src/lib/regional-arcgis.ts:107)),
  modelled on the Whangarei block:
  - `zoneLayers`: one `zone(ZONES_URL, layerId, label, "ZONE_TYPE", ["SUB_TYPE","ZONE_TYPE","NAME"], ["SUB_TYPE","TLA","LOCATION"])`
    per zone-type layer `0..5` of `ResourceManagementAndPlanning/Zones/MapServer` (tried in
    order; first polygon at the point wins).
  - `overlayLayers`: `overlay(...)` entries for the ManagementAreas / SpecialFeatures sublayers
    + the four hazard MapServers (flood/fault → `restricted`; liquefaction/tsunami → `moderate`;
    designations/management areas → `control`). Layer IDs enumerated via `?f=pjson` at implementation.
- This single config drives **both** the property-overview zone (`fetchRegionalPlanningZone`)
  **and** the Plan-tab site-plan overlays (`regionalSitePlanOverlayLayers` →
  `regionalPlanningOverlayLayers` in site-plan.ts).

### 4. Three waters — `artifacts/api-server/src/lib/regional-infrastructure.ts`
- Add a `wairarapa` entry to `REGIONAL_INFRASTRUCTURE` ([:75](artifacts/api-server/src/lib/regional-infrastructure.ts:75)) with three `group(...)`s
  (Water Supply / Wastewater / Stormwater), each pointing at the matching `Services/*Public/MapServer`
  and listing the **Masterton + Carterton** leaf layer IDs confirmed above. Owner label
  "Masterton / Carterton District Councils (Wairarapa Maps)".
- This drives **both** the site-plan three-waters pipe layers (`regionalServiceLayers`) and the
  report-prose servicing cost (`fetchRegionalInfrastructure`).

### 5. Indicative subdivision rule packs + ROI enablement — `artifacts/api-server/src/lib/regional-rules.ts`
- Add `wairarapa` rule pack(s) to `REGIONAL_RULE_PACKS` (template: the Wellington packs at
  [:608-696](artifacts/api-server/src/lib/regional-rules.ts:608)), matched on the combined-plan
  `ZONE_TYPE` names the Zones service returns:
  - `WRP_RESIDENTIAL` — `zonePattern: /\bresidential\b/i`, indicative `standardMinimumLotSqm`
    (seed ~400sqm, clearly captioned indicative), `roiEnabled: true`, `sourceLabel`/`sourceUrl`
    → Wairarapa Combined District Plan, with "confirm the exact minimum net site area against
    the operative plan" caveats.
  - (Optional) a rural pack for `/\b(special rural|primary production)\b/i` with a large
    indicative minimum and `roiEnabled: true` so rural-lifestyle ROI still models.
- Add `"wairarapa"` to `INTERIM_COMPARABLE_ROI_PROVIDERS` ([:116-125](artifacts/api-server/src/lib/regional-rules.ts:116))
  as a safety net so zones without a pack still get comparable-sales ROI (matches Nelson/QLDC).

### 6. ROI robustness for a thin-comparable market — `artifacts/api-server/src/lib/pipeline.ts`
- Add `"wairarapa"` to `regionalCvExitFallbackAllowed` ([:1748-1750](artifacts/api-server/src/lib/pipeline.ts:1748))
  so ROI can fall back to the subject CV/listing price (flagged low-confidence) when no credible
  comparable pricing is found — Masterton has fewer comparable sales than metro Auckland.
- (Optional) add to `regionalComparableFallback` (~1655) and `hasCompleteDirectRegionalCore` (~513)
  for district-wide comparable reuse.

### 7. (Optional follow-ups — note, don't necessarily build now)
- **South Wairarapa three-waters** (Featherston/Greytown/Martinborough) lives on the Wellington
  Water host, not `gis.mstn`. `RegionalInfrastructureGroup` is single-serviceUrl, so SWDC needs
  its own group(s) pointing at `SWDC_3_Waters_Underground_Services2`. Masterton (the user's
  property) and Carterton are fully covered without it; wire SWDC as a fast-follow.
- **Council CV source:** optionally add a `wairarapa` handler in
  `regional-property-history.ts` (`fetchRegionalPropertyHistory`, template: Southland/Whakatane)
  using the MDC `PropertyAndBoundaries` rating service, so CV-exit fallback has a real CV even
  when scrapers miss it.

## Critical trap to respect

A regional provider only gets a **non-null `zone_code`** (and therefore any scores at all) when
the ArcGIS **zone layer returns a real code** OR a rule pack matches — see
[pipeline.ts:1197-1206](artifacts/api-server/src/lib/pipeline.ts:1197). So step 3's zone config
is functionally required; steps 5-6 alone are not enough. Verify the Zones layer actually
returns a polygon at 78 Opaki Road before assuming scores will appear.

## Verification

1. **Unit/integration tests** (extend existing suites):
   - `regional-planning.test.ts` — assert a Masterton (78 Opaki Rd), Carterton, and Featherston
     address + coordinates each resolve to `wairarapa` (and Featherston does NOT fall through to
     `wellington`).
   - `regional-cost-profiles.test.ts` — `regionalCostProfileForProvider("wairarapa")` returns
     the Auckland numbers (empty override) with `id: "wairarapa-default"`.
   - `regional-rules.test.ts` — a `ZONE_TYPE: "Residential"` zone under `wairarapa` yields a rule
     pack with `roiEnabled: true` and `automaticRoiAllowed: true`.
   - `regional-arcgis.test.ts` / `regional-infrastructure.test.ts` — smoke-target enumerators
     now include `wairarapa` (update any asserted counts).
   - Run: `pnpm --filter @workspace/api-server test` (or the repo's vitest task).
2. **Live GIS smoke** (there is an existing `scripts/smoke-regional-planning.ts` enumerator):
   confirm the Wairarapa zone/overlay/three-waters endpoints return features for the subject
   coordinates before/after wiring.
3. **End-to-end** via the API + mobile preview:
   - Re-analyse **78 Opaki Road, Lansdowne, Masterton** (a fresh analysis — the user's existing
     cached report has `zone: UNKNOWN` and must be recomputed / cache-refreshed to pick up the
     new provider; the pipeline's `refreshRegionalPlanning` path handles this).
   - Confirm: property overview `zone` shows the real Wairarapa Combined DP zone (not "Unknown
     zone"); the ROI section renders; dev scoring shows Cost · Ease · ROI; the Plan-tab Site plan
     card shows stormwater / wastewater / potable water layers + overlays/controls.
   - Requires **`LINZ_BASEMAPS_API_KEY`** set for the aerial base (app-wide requirement, not
     Wairarapa-specific; without it the aerial falls back to the cream placeholder but vector
     layers still render).

## Out of scope / no change needed
- Mobile app (`FeasibilityReport.tsx`, `SitePlanCard.tsx`) — fully data-driven.
- Cost estimator, ROI calculator, scoring, development strategies — already region-parameterised.
- `SCORING_VERSION` bump — scoring math is unchanged; only a previously-`unsupported` region
  becomes scorable. (Existing cached Wairarapa reports still need a recompute to refresh their
  stored `UNKNOWN` zone.)