# Wire Matamata-Piako District (Waikato) — ROI/cost, zoning & site-plan infra

## Context

The user analysed **19 Centennial Avenue, Te Aroha**. Geocoding (Nominatim) resolves it to
`-37.5352, 175.7075` → **"19, Centennial Avenue, Te Aroha, Matamata‑Piako District, Waikato, 3320"**.

Te Aroha sits in the **Matamata‑Piako District** (territorial authority: **Matamata‑Piako District Council / MPDC**), **Waikato Region**. Today this district has **no planning provider** in the app: the coordinate is north of Waipā's box (`maxLat -37.70`) and Hamilton's (`maxLat -37.62`), south of Auckland's (`minLat -37.35`), and west of Rotorua's (`minLng 175.85`), so `resolvePlanningJurisdiction` falls through to `"unsupported"`. Consequences match the exact symptoms reported:

1. **No ROI section / no dev scores** — `unsupported` has no cost profile wired and `merged.zone_code` ends up null → the scoring gate returns `"missing_zone"` (`pipeline.ts` `developmentScoreUnavailableReason`), so scores, costs, scenarios and strategies are all suppressed.
2. **"Unknown zone"** — no ArcGIS zone-layer config for the district → `partialProviderZone()` returns `zone_code: "UNKNOWN"`.
3. **Blank Site Plan services/overlays** — `REGIONAL_INFRASTRUCTURE["unsupported"]` and `CONFIGS["unsupported"]` are undefined → no 3‑waters lines, no overlays/controls.

This is the same class of fix as the rural Bay of Plenty work: register a new regional provider end‑to‑end. The good news (verified live during planning): **MPDC self‑hosts every dataset we need** on its own ArcGIS Online org `services9.arcgis.com/piFyx8f2y0yspZiu` (owner `MatamataPiakoDistrictCouncil`).

### Verified live endpoints (all queried during planning)

| Purpose | Service (base `https://services9.arcgis.com/piFyx8f2y0yspZiu/arcgis/rest/services/…`) | Notes |
|---|---|---|
| **Zoning** | `District_Plan_Zones/FeatureServer` | 9 layers, **one per zone class** (see below). A point query at the property returned **1 feature from layer 4 = Residential Zone**. |
| Potable water | `Water_Line/FeatureServer/0` (+ `Water_Point`, `Water_Supply_Catchment`) | polyline, Query enabled |
| Wastewater | `Wastewater_Line/FeatureServer/0` (+ `Wastewater_Point`) | polyline |
| Stormwater | `Stormwater_Line/FeatureServer/0` (+ `Stormwater_Points`, `Stormwater_Catchment`) | polyline |
| Overlays/controls | `Flood_Zone`, `Land_Instability`, `Peat_Land_Area`, `Wind_Zones`, `Heritage_Sites`, `Wāhi_Tapu_Sites`, `Significant_Natural_Features`; plus `District_Plan_Zones/1` (Designation) & `/8` (Water Course) | each a single-layer FeatureServer/0 (geometry type to confirm per layer) |

**District_Plan_Zones layers:** `0 Business`, `1 Designation`, `2 Industrial`, `3 Kaitiaki`, `4 Residential`, `5 Rural Residential 2`, `6 Rural Residential`, `7 Rural`, `8 Water Course`.
**Key structural quirk:** these zone polygons carry **no zone-name attribute** (only `FID`, `MSLINK`, `Shape__*`) — **the zone identity is the layer name**, unlike every other council (which reads a `codeField`/`nameFields` attribute). This drives the one genuinely new code path below.

All file paths are under `artifacts/api-server/src/lib/` unless noted.

---

## Requirement 1 — Apply Auckland ROI & cost modelling (future-proof) + dev scoring

### 1a. Register the provider (routing) — `regional-planning.ts`
- Add `"matamata-piako"` to the `PlanningProviderId` union (`:8‑22`).
- Add bounds near `:156‑173`:
  ```ts
  const MATAMATA_PIAKO_BOUNDS: Bounds = { minLat: -37.86, maxLat: -37.28, minLng: 175.45, maxLng: 176.02 };
  ```
  Chosen so Te Aroha, Matamata (`-37.81/175.77`), Morrinsville (`-37.65/175.53`), Waharoa/Waihou are **in**, while Cambridge (`-37.89`) and Te Awamutu (`-38.01`) fall **out** by latitude and Hamilton (`≤175.43`) falls **out** by longitude.
- Insert a `provider("matamata-piako", "Matamata-Piako District Council planning provider", "Matamata-Piako District Council", "Waikato", "partial", "Matamata-Piako District Plan", [endpointRefs…], supports)` entry in `providerRegistry` **before the `waipa` entry** (`:226`). Because MPDC/Waipā rectangles interlock in the rural strip between Matamata and Cambridge, ordering MPDC first lets it claim Matamata while Cambridge/Te Aw. stay Waipā (they're outside MPDC bounds). `supports = (ctx) => supportsAny(ctx, MATAMATA_PIAKO_BOUNDS, [/\bte aroha\b/, /\bmatamata\b/, /\bmorrinsville\b/, /\bwaharoa\b/, /\bwaihou\b/, /\bte poi\b/, /\btahuna\b/, /\bwalton\b/, /\bspringdale\b/, /\btatuanui\b/, /\bmatamata-piako\b/])`.
  - `endpointRefs`: the MPDC zone + three‑waters services above + `https://data-waikatolass.opendata.arcgis.com/` (mirror the Waipā entry `:233‑239`).

### 1b. Cost profile — `regional-cost-profiles.ts`
- Add `"matamata-piako-default"` to the `CostProfileId` union (`:3‑17`).
- Add the **required** `PROVIDER_PROFILE_META` entry (`:213`, a full non‑partial `Record` — this is the only spot the compiler forces):
  ```ts
  "matamata-piako": { id: "matamata-piako-default", label: "Matamata-Piako default cost profile (Auckland assumptions)" },
  ```
- Add `"matamata-piako": {}` to `REGIONAL_COST_OVERRIDES` (`:194`). Empty override = **Auckland numbers verbatim, isolated and editable later** (exactly the "future-proof so I can edit later" ask; documented pattern at `:177‑189`). Do **not** touch `AUCKLAND_DEFAULT`.

### 1c. Turn on dev scoring + ROI — `regional-rules.ts`
Scoring needs `merged.zone_code` non‑null (1b/Req 2 give it) + `land_area_sqm>0` + standalone typology. The ROI section additionally needs `regionalRoiAllowed` and `hasRoiExitPricing`.
- Author MPDC rule packs in `REGIONAL_RULE_PACKS` (`:127`), matching the **layer-name zone text** the zone fetch returns (patterns tested against `zone_code + zone_description + raw_zone`):
  - `MPDC_RESIDENTIAL` — `zonePattern: /\bresidential zone\b/i`, `excludedZonePattern: /\brural residential\b/i`, `roiEnabled: true`.
  - `MPDC_RURAL_RESIDENTIAL` — `/\brural residential\b/i` (covers "Rural Residential" and "Rural Residential 2"), larger min lot, `roiEnabled: true`.
  - `MPDC_RURAL` — `/\brural zone\b/i` with `excludedZonePattern: /\brural residential\b/i`, `roiEnabled: true`.
  - `standardMinimumLotSqm`: seed **INDICATIVE** values with explicit `caveats` (mirroring the Wellington precedent) and `sourceLabel`/`sourceUrl` pointing at the MPDC District Plan / PC47; verify the operative minimum net-site areas from the District Plan subdivision chapter during implementation before removing the "indicative" caveat.
- Add `"matamata-piako"` to `INTERIM_COMPARABLE_ROI_PROVIDERS` (`:116`) so **any** MPDC zone (incl. business/industrial or an unmatched zone) still gets comparable‑based ROI once a real `zone_code` resolves.
- (Recommended) add `"matamata-piako"` to `regionalCvExitFallbackAllowed` (`pipeline.ts`, currently rotorua/whakatane/southland) so rural MPDC addresses with sparse comparables still surface ROI off CV/listing exit pricing.

---

## Requirement 2 — Resolve the zone from the council API (kills "unknown zone")

### 2a. Add the zone-layer config — `regional-arcgis.ts` `CONFIGS` (`:107`)
Add a `"matamata-piako"` entry. Register each MPDC zone class as its own `RegionalZoneLayer` (point-in-polygon returns exactly one, so order is safe; list common zones first for latency):
```
Residential(4), Rural Residential(6), Rural Residential 2(5), Rural(7), Business(0), Industrial(2), Kaitiaki(3)
```
Service const: `MPDC_DISTRICT_PLAN = "https://services9.arcgis.com/piFyx8f2y0yspZiu/arcgis/rest/services/District_Plan_Zones/FeatureServer"`.

### 2b. One new code path: layer-name-as-zone — `regional-arcgis.ts`
MPDC layers have no zone attribute, so `firstText(attrs, nameFields)` is empty. The `label` **already** flows into `zone_description` (`:621`, `:626`), but `zone_code` would default to the generic `"REGIONAL"` (`:625`). Make the code meaningful and rule-matchable with a minimal, backward-compatible enhancement:
- Add optional `staticZoneCode?: string` (and optional `staticZoneName?: string`) to the `RegionalZoneLayer` interface (`:12‑19`).
- In `fetchRegionalPlanningZone` (`:615‑628`): use `layer.staticZoneName` as a `name` fallback and prefer `layer.staticZoneCode` for the code:
  ```ts
  const name = decoded ?? firstText(attrs, layer.nameFields) ?? layer.staticZoneName ?? null;
  // …
  zone_code: rawCode ?? layer.staticZoneCode ?? name ?? "REGIONAL",
  ```
- Register MPDC layers with e.g. `{ serviceUrl: MPDC_DISTRICT_PLAN, layerId: 4, label: "Residential Zone", nameFields: [], staticZoneCode: "MPDC_RESIDENTIAL", staticZoneName: "Residential Zone" }`. (An optional `zoneStatic()` helper alongside `zone()` at `:422` keeps the config tidy.)

This yields, for 19 Centennial Ave: `zone_code: "MPDC_RESIDENTIAL"`, `zone_description: "Residential Zone …"` → Property Overview shows **Residential Zone**, and the `MPDC_RESIDENTIAL` rule pack matches → yield + ROI.

---

## Requirement 3 — Site Plan: stormwater / potable water / wastewater + overlays & controls

The mobile Site Plan card (`artifacts/mobile/components/report/SitePlanCard.tsx`) and the route (`analyse.ts` `GET /analyse/:searchId/site-plan`) are **provider-agnostic** — no mobile change needed. Two backend maps drive it:

### 3a. Three-waters — `regional-infrastructure.ts` `REGIONAL_INFRASTRUCTURE` (`:75`)
Add service consts + a `"matamata-piako"` entry (mirrors the `waipa` block `:76‑86`). This single addition powers **both** the Site Plan service lines (`service-water/-wastewater/-stormwater` via `regionalInfrastructureServiceLayers`) **and** the infra connection flags (distance/cost/risk via `fetchRegionalInfrastructure`):
```ts
group("Water Supply", MPDC_WATER,      "Matamata-Piako District Council", [[0, "Water main/service line"]]),
group("Wastewater",   MPDC_WASTEWATER, "Matamata-Piako District Council", [[0, "Wastewater main/service line"]]),
group("Stormwater",   MPDC_STORMWATER, "Matamata-Piako District Council", [[0, "Stormwater main/service line"]], 1000),
```
(`Water_Line`, `Wastewater_Line`, `Stormwater_Line`, each `/FeatureServer/0`.)

### 3b. Overlays & controls — `regional-arcgis.ts` `CONFIGS["matamata-piako"].overlayLayers`
Add `overlay(...)` entries (helper at `:433`). These feed both the report overlays and the Plan-tab planning layers (`regionalSitePlanOverlayLayers`). `status: "control"` renders dashed control layers; `"restricted"`/`"moderate"` for hazards/features:
```
Flood_Zone/0            → "Flood Hazard Zone"          polygon  restricted
Land_Instability/0      → "Land Instability Area"      polygon  restricted
Peat_Land_Area/0        → "Peat Land Area"             polygon  moderate
Wind_Zones/0            → "Wind Zone"                  polygon  control
Heritage_Sites/0        → "Heritage Site"              (point/polygon — confirm) restricted
Wāhi_Tapu_Sites/0       → "Wāhi Tapu Site"             point    restricted
Significant_Natural_Features/0 → "Significant Natural Feature" polygon moderate
District_Plan_Zones/1   → "Designation"               polygon  control
District_Plan_Zones/8   → "Water Course"              polyline moderate  (optional)
```
Confirm each layer's `geometryType` from `…/<layer>?f=json` before finalising (drives point-vs-polygon query mode). MPDC overlay names are human-readable so they pass through the mobile label map fine (only Auckland names are translated).

### 3c. Aerial
No change — the LINZ Basemaps aerial path is national and already works given `LINZ_BASEMAPS_API_KEY` (falls back to `LINZ_API_KEY`). Confirm the key is set in the deploy env when verifying.

---

## Files touched (summary)

- `artifacts/api-server/src/lib/regional-planning.ts` — union member, `MATAMATA_PIAKO_BOUNDS`, registry entry (before `waipa`).
- `artifacts/api-server/src/lib/regional-cost-profiles.ts` — `CostProfileId` member, `PROVIDER_PROFILE_META` (required), `REGIONAL_COST_OVERRIDES` `{}`.
- `artifacts/api-server/src/lib/regional-arcgis.ts` — `MPDC_DISTRICT_PLAN` + overlay consts, `RegionalZoneLayer.staticZoneCode/Name`, `fetchRegionalPlanningZone` fallback, `CONFIGS["matamata-piako"]` (zone + overlay layers).
- `artifacts/api-server/src/lib/regional-infrastructure.ts` — MPDC 3-waters consts + `REGIONAL_INFRASTRUCTURE["matamata-piako"]`.
- `artifacts/api-server/src/lib/regional-rules.ts` — MPDC rule packs + `INTERIM_COMPARABLE_ROI_PROVIDERS`.
- `artifacts/api-server/src/lib/pipeline.ts` — (recommended) add `matamata-piako` to `regionalCvExitFallbackAllowed`.
- Tests (mirror existing): `__tests__/regional-planning.test.ts`, `regional-arcgis.test.ts`, `regional-infrastructure.test.ts`, `site-plan-regional.test.ts`, `regional-rules.test.ts`, cost-profile/`cost-estimator.test.ts`.
- No mobile change; **no DB schema change** (no migration needed).

---

## Verification

1. **Typecheck + unit tests** (backend): the new provider is auto-picked-up by `regionalPlanningSmokeTargets()` / `planningProviderSmokeTargets()` / `regionalInfrastructureSmokeTargets()`. Add/extend:
   - `regional-planning.test.ts`: `-37.5352, 175.7075 → "matamata-piako"`; Matamata & Morrinsville → `matamata-piako`; **regressions** Cambridge/Te Awamutu → `waipa`, Hamilton → `hamilton`, Rotorua → `rotorua`.
   - `regional-arcgis.test.ts`: `fetchRegionalPlanningZone` at the property returns Residential (`zone_code "MPDC_RESIDENTIAL"`).
   - `regional-rules.test.ts`: `MPDC_RESIDENTIAL` matches "Residential Zone", **not** "Rural Residential Zone".
2. **Live GIS smoke** — a scratch `artifacts/api-server/src/scripts/_verify-teAroha.mts` (like the existing `_verify-balfour.mts`) that runs the analyse pipeline for "19 Centennial Avenue, Te Aroha" and prints: resolved provider, zone, dev scores (cost/ease/roi), ROI scenarios, infra items, and site-plan layer groups. Confirms all three requirements against live endpoints.
3. **App end-to-end** — start the dev server (Browser preview), analyse the address, and confirm: Property Overview **zone = Residential Zone**; a populated **ROI section** + **dev scores**; Plan tab → Site Plan card shows **stormwater / water / wastewater** service lines and **overlays/controls** toggles with features; aerial renders.
4. **Cache note** — any prior `unsupported` result cached for this address must be recomputed (fresh Home search or `reacquire-cache --address="Centennial"`), since scores were previously suppressed.
5. **Ship** — commit on the current branch and merge to `main` so Vercel redeploys the backend. (Memory lesson from the BoP fix: uncommitted work never deploys — commit before "redeploy".)

## Open decisions (sensible defaults chosen; easily changed)
- **Cost numbers** stay Auckland-equal via the empty override (the explicit ask); tune `REGIONAL_COST_OVERRIDES["matamata-piako"]` field-by-field later and flip `source: "regional_verified"`.
- **Min-lot rule values** start **indicative** with caveats + District Plan source link; verify against the MPDC operative plan / PC47 during implementation.
- **Zone coverage** focuses ROI on Residential / Rural Residential / Rural (the productive-development zones); Business/Industrial/Kaitiaki still resolve a real zone and get comparable-based ROI via the interim path.