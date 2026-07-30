# Embed Rubin in the mobile app: in-app subdivision generation (two phases)

## Context

Tapping "Generate layout" in the Plan tab currently opens Rubin in **Safari** on iOS TestFlight, and returning to the app shows a stuck "Loading site — parcel, services and contours…" overlay. Root cause found: [rubin.tsx:104](artifacts/mobile/app/rubin.tsx:104) sets `originWhitelist={["https://rubin-one.vercel.app/*"]}`; react-native-webview matches the whitelist against the origin **without** a trailing slash, the match fails, and iOS punts the URL to `Linking.openURL` (Safari) while the cancelled in-app load leaves the overlay up forever (Android is unaffected — its initial `loadUrl` skips that check).

Beyond the bug, Rubin's embed mode (`?embed=1`) is today a read-only site viewer: the AI chat, Detect button, and solver UI are hidden; the only embed control is the deliberately-unwired `DesignIntentBubble` slider. There is **no postMessage bridge, no persistence, no auth** in Rubin. Its "Loading site…" overlay clears when the parcel loads but contours + 3-waters load *after* the canvas appears, and five client-side GIS fetches have no timeout (the intermittent permanent hang).

**Chosen architecture (user-confirmed):** keep the in-app WebView; build the intensity picker, confirm dialog, load gate, and autonomous detect→subdivide orchestrator **inside Rubin's embed mode** (ships via Vercel with no app-store review); add a small postMessage bridge; the app owns auth and persistence (Rubin has none). User decisions: Low = detect → `subdivide` (max yield, AUP-compliant); Medium = full reset + refetch → detect → `subdivide typology:"standalone-townhouse"`; High greyed out "coming soon". Persistence is server-side per account **plus an append-only deduped training corpus**: every distinct layout per site saved once, with attribution of every user/generation that produced it. Re-entry with a saved layout skips the intro slides.

Key existing plumbing (verified):
- Flow: `FeasibilityReport.tsx` Plan tab → [SitePlanCard.tsx](artifacts/mobile/components/report/SitePlanCard.tsx) button (:912) → tap handler `recordAiSubdivisionInterest` (:704) → `AiSubdivisionIntroModal` slides → `completeAiSubdivisionInterest` (:737) → `router.push("/rubin", {address, lat, lng})` → [app/rubin.tsx](artifacts/mobile/app/rubin.tsx) WebView loading `buildRubinEmbedUrl` ([lib/rubin.ts:42](artifacts/mobile/lib/rubin.ts:42)).
- Rubin: single page `rubin/app/page.tsx`; embed params `rubin/utils/embedParams.ts`; canvas `rubin/components/Canvas2DTab.tsx` (Fabric.js, NZTM metres, ~12k lines) with `runAICommands` at :8314 (`detect_regions` GIS pre-pass :8396, idempotent when driveways exist :8399), embed-only mount point `{embed && <DesignIntentBubble />}` at :11999, embed touch pan/zoom :10472.
- Reverted-but-recoverable (tree of commit `a1df4d7`, last commit before the `1f0542e` rollback): `utils/geoJsonOut.ts` + `tests/geoJsonOut.test.ts` (NZTM→WGS84 ring export), `app/api/v1/subdivide/route.ts` (reference only for serialization shape — we are NOT resurrecting it).
- `/api/v1/site` exists at Rubin HEAD — the api-server gate (`routes/subdivision.ts` → `lib/rubin.ts`) keeps working untouched.
- Repo constraints: **no expo-updates** (every mobile JS change = new TestFlight build → batch all app changes into one Phase-1 build); **no auto DB migration runner** (manual `add-*` script); **RLS off** (`REVOKE ... FROM anon` on new tables); Vercel deploys require the Prettycoolapple git author.

## Deploy ordering (strict)

1. DB migration script run manually → 2. api-server deploy (new routes) → 3. Rubin Vercel deploy → 4. Mobile TestFlight/Play build.
Never ship the app build before Rubin: the new app waits for the `site-ready` bridge message to clear its overlay. Old app + new Rubin is safe (old app ignores messages, keeps `onLoadEnd` behaviour).

## Bridge protocol (v1)

- Rubin→host: `window.ReactNativeWebView.postMessage(JSON.stringify(msg))` — absent in a desktop browser so the bridge no-ops and embed mode stays browser-testable.
- Host→Rubin: `webViewRef.injectJavaScript("window.__RUBIN_BRIDGE__?.receive(...); true;")` (avoids iOS/Android message-event divergence).
- Envelope `{ v: 1, type, ...payload }`; both sides ignore unknown type/version (shipped app builds can't be upgraded).
- Handshake: Rubin registers `__RUBIN_BRIDGE__` at embed mount and sends `ready {caps, build}` → host sends `init {hasSavedLayout}` → on `site-ready {parcelId, address, zone, lat, lng}` host sends `hydrate {layout, savedAt}` if it has one (Rubin buffers a hydrate that beats canvas mount). Host queues outbound until `ready`.
- Rubin→host: `ready`, `site-ready`, `site-error {stage, message, retryable}`, `run-state {state, intensity}` (telemetry), `layout-complete {intensity, typology, solverVersion, lotCount, site, canonical, layout}`, `layout-error`, `hydrated {ok}`.
- Generation is fully self-contained in Rubin (panel + confirm dialog + orchestrator + retry UI all in-page); the host only listens, plus `init`/`hydrate`.

## Orchestrator state machine (Rubin embed)

`idle → confirming (only if a layout exists — generated or hydrated) → [medium only: resetting → awaiting-site] → detecting → subdividing → capturing → done`; any failure/timeout → `error {failedState}` with Retry (restarts full sequence; detect is idempotent). One `runId` per run; every `await` re-checks `runId`. Dropdown + Generate disabled whenever state ∉ {idle, done, error} — starting Medium while Low runs is impossible by construction. Steps are separate awaited `runCommands` calls (`[{action:"detect_regions"}]` then `[{action:"subdivide"}]` / `[{action:"subdivide", typology:"standalone-townhouse"}]`) — **bypasses `/api/chat` entirely**; per-step timeouts (reset 45s, site 60s, detect 90s, subdivide 240s, capture 15s). Medium's reset: clear DESIGN layer + lots, re-run `fetchAucklandSiteData`, `setSiteGeoJSON(fresh)`, wait for parcel+infra ready, then detect → subdivide. Status text per state over the live canvas ("Detecting driveways…", "Placing townhouses…").

## Layout serialization + dedup fingerprint

`SerializedLayout` v1: `{version, crs:"EPSG:2193", solverVersion, typology, intensity, site, metrics{lotCount, lotAreasM2}, elements:[{kind: lot|gross-lot|footprint|driveway|crossing|walkpath|deck|ols|buildable, lotId?, ring:[[x,y]…], props?}]}` — NZTM as source of truth; WGS84 derived later via restored `geoJsonOut.ts` helpers (`git show a1df4d7:utils/geoJsonOut.ts`).

Canonicalization (geometry-only → dedup works across solver versions): round coords to 0.01 m → drop closing vertex, force CCW, rotate ring to lexicographically-smallest start, re-close → sort elements by (kind, lotId, first vertex) → deterministic JSON (sorted keys, no whitespace) = `canonical` string. `fingerprint = sha256(canonical)` — **server recomputes and trusts only its own hash**.

## DB schema (Drizzle, `lib/db/src/schema/`, register in index.ts)

Site keys follow the `site_plan_layer_cache` pattern: `parcel:{parcelId}` preferred, plus a `geo_key` (`{lat4}:{lng4}`) on every row because the /rubin screen knows lat/lng before parcelId.

- **`rubin_layouts`** (training corpus, append-only, deduped): id PK uuid, site_key, geo_key, fingerprint, canonical, layout jsonb, parcel_id/address/zone, typology, intensity, solver_version, lot_count, site_context jsonb (Phase 2), created_by → profiles.id, created_at. **UNIQUE (site_key, fingerprint)**; indexes on site_key, geo_key.
- **`rubin_layout_generations`** (attribution, one row per generation event incl. dedup hits): id, layout_id FK cascade, user_id FK cascade, source default 'embed', created_at. Indexes (layout_id), (user_id, created_at).
- **`rubin_user_layouts`** (per-user visible last layout; overwritten while corpus keeps everything): PK (user_id, site_key), geo_key, layout_id FK, updated_at.

Save transaction: `INSERT rubin_layouts ... ON CONFLICT (site_key, fingerprint) DO NOTHING RETURNING id` (else select existing) → always insert a generations row → upsert rubin_user_layouts.

Migration: new **`lib/db/scripts/add-rubin-layouts.mjs`** cloned from `add-site-plan-layer-cache-table.mjs` (idempotent DDL) ending with `REVOKE ALL ON TABLE rubin_layouts, rubin_layout_generations, rubin_user_layouts FROM anon;`. Run manually.

## api-server routes

New **`artifacts/api-server/src/routes/rubin-layouts.ts`** (register in `src/routes/index.ts`; `requireAuth` + durable rate limits, follow `routes/subdivision.ts` conventions):
- `POST /rubin-layouts` — `{site{parcelId?, address?, lat, lng, zone?}, canonical, layout, meta{typology, intensity, solverVersion, lotCount}}`; size-cap ~1 MB; server computes fingerprint (`node:crypto`); runs the transaction; returns `{layoutId, deduped}`.
- `GET /rubin-layouts/latest?lat&lng&parcelId&summary=1` — lookup `rubin_user_layouts` by (user, site_key) else (user, geo_key); `summary=1` returns `{exists, updatedAt, lotCount, intensity}` (cheap skip-slides check), full form includes `layout`.

## Phase 1 — everything needing the app build + minimum viable persistence

**Rubin** (all new `components/embed/` + `utils/` files unless noted):
1. `utils/hostBridge.ts` — `__RUBin_BRIDGE__` registration, envelope, `postToHost`, inbound buffering.
2. Load gate: `store/bimStore.ts` gains `siteLoad {parcel, infra}` statuses; `app/page.tsx` embed overlay (:349-364) becomes a full-screen cover that stays until parcel AND infra are ready (canvas must mount underneath to fire the infra fetch) with a Retry button; Canvas2DTab infra effect + `fetchSiteInfrastructure` get `AbortSignal.timeout(30s)` + one retry + error reporting; the five untimed fetches in `components/ProjectInput.tsx` (~:210 incl. bounding the `while(true)` pagination, ~:282, ~:349, ~:469, ~:509) get timeouts + one retry. On ready → `site-ready`; on failure → `site-error`.
3. Restore `utils/geoJsonOut.ts` + test from `a1df4d7`; add a `SOLVER_VERSION` constant (new `utils/version.ts`) stamped into every layout.
4. `utils/layoutSerializer.ts` — types + canonicalization + fingerprint, unit-tested (permuted element order / rotated ring start / reversed orientation / sub-tolerance jitter → same hash).
5. Canvas2DTab: new `onEmbedApi` prop exposing an imperative `EmbedCanvasApi` — `runCommands` (wraps :8314), `getSerializedLayout` (lots from `lotsRef` incl. `grossParcelGeoJSON`; footprints/driveways/crossings/walkpaths/decks/OLS from DESIGN-layer objects via the same helpers `runAICommands` uses), `hydrateLayout` (NZTM ring → px via `projectionRef` → Fabric objects with the existing style constants, `selectable:false`, tagged for reset), `hasLayout`, `resetDesign`. No refactor of the 12k-line component.
6. `components/embed/useEmbedOrchestrator.ts` (state machine above) + `components/embed/EmbedGeneratePanel.tsx` — collapsible panel replacing `<DesignIntentBubble />` at Canvas2DTab:11999: dropdown Low ("max lots") / Medium ("townhouses") / High ("coming soon", disabled), Generate, status line, error+Retry, in-panel confirm dialog ("Replace the current layout?" Cancel/Replace).

**api-server / lib/db:** schema files ×3 + registration; migration script (run it); routes + route tests.

**Mobile (one build):**
7. [app/rubin.tsx](artifacts/mobile/app/rubin.tsx): whitelist fix (`originWhitelist={[getRubinOrigin(), `${getRubinOrigin()}*`]}`); `onMessage` handler; overlay cleared by `site-ready`/`site-error` instead of `onLoadEnd`, plus a 90 s watchdog → existing failed+retry UI; on `layout-complete` POST to api-server (auth'd, 2 retries, non-blocking); on mount, TanStack query `GET /rubin-layouts/latest` → feeds `init.hasSavedLayout` + `hydrate` after `site-ready`.
8. New `lib/rubinBridge.ts` — message types/guards + save/latest fetchers (follow `lib/subdivision.ts` patterns).
9. [SitePlanCard.tsx](artifacts/mobile/components/report/SitePlanCard.tsx) skip-slides: in `recordAiSubdivisionInterest`, a `summary=1` query (enabled when `subdivision.available`, parcelId piggybacked from the existing gate result); if a layout exists and the user isn't due the free-tier upgrade slide, skip the modal and push `/rubin` directly (still firing the interest-event analytics POST).
10. i18n keys as needed (panel strings live in Rubin, English-only initially — Rubin has no i18n; acceptable, noted as follow-up).

## Phase 2 — Vercel + server only, zero app builds

1. Hydration polish (area labels, lot numbers, "Restored {date}" chip, zoom-to-fit).
2. Corpus enrichment: `site_context` snapshot (parcel ring, zone rules, contours/services summary) on save; `export-rubin-corpus` script producing (site_context, layout) training pairs, NZTM→WGS84 via geoJsonOut.
3. Robustness: per-step timeout tuning from telemetry; visibilitychange handling (backgrounded mid-run → error+Retry on resume rather than silent hang).
4. Enable High intensity later by flipping the disabled flag (Vercel-only by design). Optional `GET /rubin-layouts/history`.

## Failure modes

Rubin down → existing onError/onHttpError + watchdog. GIS hang → Rubin-side timeouts + `site-error`; host watchdog backstop. Solver failure → `error` state + Retry. Save POST fails → 2 retries, layout stays on canvas, logged. WebView killed mid-run → remount hydrates last *saved* layout (in-flight run lost, user retries). Concurrent duplicate saves → idempotent via the unique constraint. Old-app/new-Rubin and new-app/old-Rubin covered by ignore-unknown + deploy ordering.

## Verification

- **Rubin unit tests** (note: `npm test` needs Node ≥22.6; machine is on v20 — run tests via CI/Vercel or nvm): serializer fingerprint stability/divergence; geoJsonOut round-trip.
- **Desktop browser** `http://localhost:3000/?embed=1&address=…&lat=…&lng=…` (launch.json `rubin-dev`): load gate holds until parcel+infra; network-kill mid-load → Retry works; Low run shows detect→subdivide progress with controls locked; Medium visibly resets+refetches; confirm dialog on second Generate.
- **api-server route tests**: same canonical twice → `deduped:true`, 1 layout row, 2 generation rows; latest by parcelId and geo fallback; summary form; 401 unauth'd; `anon` cannot select new tables; migration re-run is a no-op.
- **Device (iOS simulator + physical, Android)**: `EXPO_PUBLIC_RUBIN_URL` at LAN Rubin for local runs (bridge testing needs a device — WebView is a no-op on RN web). Tap Generate layout → **stays in-app on iOS**; single native overlay until fully-drawn canvas; Low run → rows appear in `rubin_layouts`/`rubin_user_layouts`; kill+reopen → re-entry skips slides and shows hydrated layout; free-tier account still sees the upgrade slide; back button returns to the Plan tab; black-hole `EXPO_PUBLIC_RUBIN_URL` → failed+retry within 90 s.
- **Cross-device**: generate on device A, open on B (same account) → hydrated.

## Risks

- **Canvas2DTab integration (highest):** `getSerializedLayout`/`hydrateLayout` depend on internal refs/WeakMaps; verify every element kind (decks/OLS/walkpaths from the AUP completeness pass) actually lands on the DESIGN layer with `objectLotId` set.
- **Medium reset re-entrancy:** the orchestrator fetches site data itself and calls `setSiteGeoJSON` directly — must not fight page.tsx's `embedLoadStartedRef` guard or double-fire the infra effect.
- **Fingerprint tolerance (0.01 m)** assumes solver noise < 1 cm; nondeterministic-at-larger-scale runs create distinct corpus rows (acceptable — they are distinct options) but monitor.
- **Bridge/HTTP payload size:** dense layouts may reach hundreds of KB — cap at 1 MB, test on low-end Android.
- **Vercel author rule:** Rubin commits must be authored by Prettycoolapple or the deploy never builds.