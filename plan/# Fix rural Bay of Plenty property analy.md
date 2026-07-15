# Fix rural Bay of Plenty property analysis (1140 / 1134 Braemar Rd, Rotomā)

## Context

Analysing rural Whakatāne/Bay-of-Plenty addresses (e.g. **1140 Braemar Rd Rotoma**) in the mobile app produces:
- **Fabricated Property Overview** — CV $1,200,000, land 20,000 m², floor 180 m² (estimated) — none of which are real.
- **Two near-identical address suggestions** for the same parcel.
- **No dev scores** (Ease/Cost/ROI) with a misleading "no comparable sales" message.
- **Blank Site Plan** — no aerial, no parcel boundary, no infrastructure/overlays.

This was verified end-to-end. All symptoms trace to **one root cause**: the geocoder hard-fails rural BoP addresses, which empties the whole pipeline. A prior "fix + redeploy" didn't help because it didn't address that root cause (and a redeploy never re-acquires already-broken cached data).

### Ground truth (verified this session)

Live Whakatāne District Council GIS (public, **no login/key**) — `.../PropertyRoadSearch/MapServer/2`, and cross-checked against OneRoof + HouGarden listings:

| Address | CV | Land (SurveyArea) | Floor | Beds | Built | Title |
|---|---|---|---|---|---|---|
| **1140 Braemar Rd Rotomā** | **$630,000** | **3,435 m²** | 101 m² | 3 | 1940 | Freehold |
| 1134 Braemar Rd Rotomā | $1,310,000 | 61,829 m² | — | — | — | Freehold |
| 1134A Braemar Rd Rotomā | $1,340,000 | 49,435 m² | — | — | — | — |

These match the app's own smoke-test fixture (`smoke-regional-planning.ts:24-25`). The property last sold Feb 2021 and was built 1940 — **not** subdivided/merged, so this is **not** a stale-data case.

### Direct answers to the questions raised

- **Which address is correct? Are the two the same?** They are the **same physical parcel/title** — one label from Nominatim ("…Whakatāne District, Bay of Plenty"), one from LINZ ("…Rotomā, Whakatāne"). Canonical = **1140 Braemar Road, Rotomā, Whakatāne District, Bay of Plenty**. Neither is "wrong"; the duplicate simply shouldn't appear.
- **Why were two suggested? Is address mismatch the culprit?** The duplicate is a *symptom*, not the culprit. Dedupe (`sameAddressCandidate`) can't collapse them because the LINZ candidate has **null coordinates** (its hydration calls the same exact-match-only geocoder that fails), so the distance check is skipped and text similarity (~0.62) is below the 0.78 threshold.
- **Why is the data wrong?** Geocode fails → pipeline yields no `merged` bundle → the deterministic overwrite `applyOverviewSnapshot` early-returns → the **LLM's placeholder values render as facts**. `$1,200,000` is literally the example in the prompt template (`prompts.ts:102`).
- **Is the source unreliable / need login/APIs? Is it stale?** No. The council GIS is public and holds exact, current data. Not stale, not subdivided.
- **Why did a backend test show correct data but the app didn't?** A direct GIS/pipeline test resolves data **by address text or runs live** (my verification queried the GIS by `Location LIKE '1140 BRAEMAR%'`, bypassing geocoding). The **app** resolves via a **point-in-polygon query at a geocoded coordinate** the BoP geocoder refuses to produce — so it misses. A code redeploy can't fix already-cached broken rows.
- **Do I need to re-run the cached scan?** Yes — after the code fix, run the live `reacquire-cache` (below). Code fix ≠ data fix.

---

## Root cause (single, high-leverage)

`geocodeAddress → tryGeocodeAddress` (`artifacts/api-server/src/lib/geocode.ts:365-418`): for Whakatāne/Rotorua/Rotomā addresses, `shouldRequireExactCouncilAddress` (`geocode.ts:190-195`) forces an exact council-GIS match and, on miss, **returns `null` without falling back to Google/Nominatim** (`geocode.ts:373`). The exact `where` clauses (`geocode.ts:105-118`) demand a clean `HouseNumber`+`RoadName`; "1140 Braemar Rd Rotoma" (no comma) parses the locality into the road string (`parseCouncilStreetAddress:129-147`) → exact match misses → geocode throws → pipeline empties (`pipeline.ts:659-713`). Nominatim *does* return a precise coordinate for this address; it's just never used.

---

## The fix (layered; ordered by leverage & safety)

### Fix A — BoP geocode resolution *(core; unblocks almost everything)*
`geocode.ts` — when the exact council lookup misses for BoP, **fall back to Google/Nominatim** instead of returning null, and make the council `where` tolerant of `Rd→Road` and comma-less "glued" localities.
- Files: `geocode.ts:365-418` (`tryGeocodeAddress`), `:190-195` (`shouldRequireExactCouncilAddress`), `:129-147` (`parseCouncilStreetAddress`), `:87-127` (Rotoma/Braemar dual-probe).
- **Don't break Auckland:** keep exact council match as *primary*; only *add* the fallback. Auckland never hits this branch.

### Fix B — Address-text GIS fallback *(belt-and-suspenders for CV/land)*
`regional-property-history.ts` — when the point query's `exactAddressFeature` finds no matching feature, run a second **attribute query** `where=Location LIKE '<num> <STREET>%'` (proven to return 1140 → $630k / 3,435 m²). Makes CV/land resolve even if the coordinate lands just off the parcel polygon.
- Files: `regional-property-history.ts:234-254` (Whakatāne query), `:153-160` (`exactAddressFeature`). Apply the same pattern to the Southland/Christchurch branches only if low-risk.

### Fix C — Provider routing for Rotomā *(secondary; verify)*
Lake Rotomā sits on the Whakatāne/Rotorua boundary; `resolvePlanningJurisdiction` routes **by coordinate bbox first** (`regional-planning.ts:479-504`). Confirm 1140 Braemar routes to the **whakatane** provider (it's administratively Whakatāne and only Whakatāne's GIS has the CV). If it mis-routes to rotorua, widen `WHAKATANE_BOUNDS` (`regional-planning.ts:169-170`) or let the "rotoma"/"braemar" address hint (`:415`) win for property-history routing.

### Fix D — Never render hallucinated facts *(critical safety net; do regardless)*
`analyse.ts` `applyOverviewSnapshot` — change `if (!merged) return;` (`analyse.ts:586`) so that when `merged` is null/incomplete, CV/land/floor/beds/build-year are **blanked / marked unavailable**, never left as LLM output. Also harden the prompt to stop emitting example-shaped values.
- Files: `analyse.ts:581-653`; `prompts.ts:102-104` (remove "e.g. $1,200,000", "estimated floor area…"; instruct null when unknown); confirm `FeasibilityReport.tsx:2733-2946` renders the "unavailable" state for nulls.
- **Don't break Auckland:** only the null-`merged` path changes; the populated path is untouched.

### Fix E — Honest score-unavailable message
`FeasibilityReport.tsx` `ScoreSummaryRow` — read the already-serialized `score_unavailable_reason` (`analyse.ts:1234-1235`) and show the real reason (missing zone / missing land area / genuinely no comparables) instead of the hardcoded "no comparable sales" (`FeasibilityReport.tsx:637-666`). Reuse the wording in `buildDevScoreNotice` (`post-analysis-answer.ts:153-168`). Keep the all-zero fallback for legacy reports lacking the field.

### Fix F — Collapse the duplicate address suggestion
`address-clarification.ts` — once Fix A lets the LINZ candidate hydrate coordinates, the distance check collapses the pair. Additionally strengthen `sameAddressCandidate` to merge when **leading street number + street-key match** and one locality tail is a parent/child of the other. Fix the misleading geocoder mock in `address-resolution-unit.test.ts:60-81`.
- Files: `address-clarification.ts:223-263`, `:356`. **Guard against over-merging** 1140 vs 1134 by requiring identical leading street number.

### Fix G — Floor area / beds / build year via ScrapingBee *(new wiring)*
Council GIS has none of these for BoP, and `fetchRegionalPropertyHistory` returns them null (`regional-property-history.ts:264-275`). The listings' data lives on OneRoof/HouGarden, and **OneRoof already has a serverless-safe ScrapingBee path** (`oneroof.ts:637-682`) — but WAVE 1 skips it on serverless (`pipeline.ts:790-793`).
- Distinguish **ScrapingBee HTTP scrapers (serverless-OK)** from **Playwright browser scrapers (serverless-off)** in the WAVE 1 gate (`pipeline.ts:758,773-797`) so OneRoof/HouGarden's ScrapingBee paths run in prod for the fields council GIS can't supply.
- Fix Homes' ScrapingBee URLs that hardcode `/auckland/` (`homes.ts:431-436`) to use the real suburb/region.
- Verify the merge address-match gate accepts BoP matches (`merge.ts:516-542`); keep the street-number-aware score gate to avoid false positives.
- **Cost note:** adds ScrapingBee calls per rural lookup (already budgeted for Auckland).

### Fix H — Site Plan aerial + infrastructure + overlays *(mostly automatic after A/C)*
- **Aerial:** no code change — key present, national tiles (`site-plan.ts:449-530`); renders once a coordinate exists.
- **Infrastructure (waste/potable/storm) + overlays/controls:** already wired for whakatane/rotorua (`regional-infrastructure.ts:66-120,374`; `regional-arcgis.ts:312-366,711`; dispatched at `site-plan.ts:816-875,953-1007`). Fires once regional planning is on (default), the jurisdiction resolves (Fix C), and the coordinate is correct (Fix A). Mainly verify + adjust Rotomā routing.

---

## Operational rollout (order matters)

1. Implement Fixes A–H on a branch; add/adjust unit tests (esp. the mocked geocoder in `address-resolution-unit.test.ts`).
2. Verify locally: `pnpm --filter @workspace/api-server smoke:regional-planning` (expects **$630k**/1140, **$1.31M**/1134) + existing tests green.
3. Deploy backend.
4. **Re-acquire cache (live)** for affected rows — code fix does not repair cached data:
   - `pnpm --filter @workspace/api-server reacquire-cache -- --address="Braemar"`
   - then `... reacquire-cache -- --only-unavailable` to repair other rural properties that cached empty. (Or the admin `POST /admin/property-cache/rescan`.)
5. Verify in the mobile app (below).

---

## Verification (end-to-end)

**Backend / data**
- `smoke:regional-planning` passes with the expected CVs.
- Direct check the address-text GIS fallback returns 1140 → $630k / 3,435 m² and 1134 → $1.31M.
- Confirm geocode fallback yields a coordinate for "1140 Braemar Rd Rotoma" (no comma) and routes to the **whakatane** provider.

**Mobile app (fresh search, not history)** — search **"1140 Braemar Rd Rotoma"**:
- **One** address suggestion (or none needed), not two.
- Property Overview: CV **$630,000**, land **3,435 m²**, zone **Rural Production Zone**, title **Freehold**; floor **101 m²** / **3** beds / **1940** populated (or an honest "unavailable" — never fabricated).
- Dev scores present, or an honest reason if genuinely unavailable.
- Site Plan (Plan tab): aerial imagery renders, parcel boundary drawn, and waste/potable/storm connections + overlays/controls populate.
- Repeat for **1134 Braemar Rd Rotoma** ($1.31M) to confirm the class is fixed, not just one address.

**Regression guard**
- Re-analyse a known-good **Auckland** address: overview, scores, site plan, infrastructure, and aerial unchanged. All changes here are additive fallbacks or null-path guards; the Auckland code path is untouched.

---

## Files at a glance

- `artifacts/api-server/src/lib/geocode.ts` — Fix A, F (coordinate root cause).
- `artifacts/api-server/src/lib/regional-property-history.ts` — Fix B (address-text GIS fallback).
- `artifacts/api-server/src/lib/regional-planning.ts` — Fix C (Rotomā → whakatane routing).
- `artifacts/api-server/src/routes/analyse.ts` (`applyOverviewSnapshot`) + `artifacts/api-server/src/lib/prompts.ts` — Fix D (kill hallucinations).
- `artifacts/mobile/components/FeasibilityReport.tsx` — Fix E (honest message) + overview render.
- `artifacts/api-server/src/lib/address-clarification.ts` (+ its unit test) — Fix F (dedupe).
- `artifacts/api-server/src/lib/pipeline.ts`, `scrapers/oneroof.ts`, `scrapers/homes.ts`, `scrapers/merge.ts` — Fix G (ScrapingBee floor/beds/year on serverless).
- `artifacts/api-server/src/lib/site-plan.ts`, `regional-infrastructure.ts`, `regional-arcgis.ts` — Fix H (verify; mostly automatic).
- `artifacts/api-server/src/scripts/reacquire-cache.ts`, `smoke-regional-planning.ts` — rollout + verification.
