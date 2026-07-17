# Site Plan card: instant AI-subdivision button, adaptive popup, instant overlay toggles

## Context

Three problems in the **Site plan** card (Plan tab of the feasibility report), all in the mobile app:

1. **"AI subdivision" button feels slow to respond on tap.** Investigation shows the button already opens the modal *optimistically and synchronously* (`setShowAiModal(true)` runs before the fire-and-forget analytics `fetch`, which is never awaited). There is **no** blocking network/LLM call. The lag is pure **main-thread JS**: toggling `showAiModal` re-renders the whole heavy `SitePlanCard`, and the `<Svg>` re-projects **every feature of every visible map layer inline in JSX** on that render, right before the RN `Modal` fade.

2. **AI Subdivision popup slides 3 & 4 overlap (buttons over text).** The popup card is a rigid box: `minHeight: 420` with the copy area set to `flex: 1`. Space is allocated rigidly instead of fitting each slide's content, so slides with short bodies / different button counts (slide 3 `upgrade`, slide 4 `launch`) end up with the actions block laid over the copy. User wants it **fully adaptive to content**.

3. **Overlay layers (waste water, storm water, potable water, contours) take 5–10s to appear after toggling ON and 5–10s to disappear after toggling OFF.** The user confirmed the switch itself flips instantly; it's the *layer geometry* that lags. Root cause is the **same** as #1: `toggleLayer` mutates `visibleLayers` → `visibleVectorLayers` changes → the entire `<Svg>` re-runs `renderFeature` (Mercator projection math) for **all** visible layers, un-memoized. Turning on contours (up to ~1200 features) projects everything; turning it off re-projects all the *remaining* layers too — hence lag in both directions. **Toggling does NOT hit Vercel** (data is fetched once with the site-plan payload; toggles are local state), so there is no serverless CPU cost to optimize — the fix is entirely client-side rendering.

**Outcome:** button opens instantly, popup fits each slide, overlay layers show/hide immediately.

---

## Core fix (solves #1 and #3): memoize rendered SVG per layer

**File:** [SitePlanCard.tsx](artifacts/mobile/components/report/SitePlanCard.tsx)

Today the `<Svg>` body (lines ~844–863) builds every SVG element from scratch on every render:

```tsx
{visibleVectorLayers.flatMap((layer) =>
  layer.geojson.features.map((feature, i) => renderFeature(feature, layer, bounds, w, h, i)))}
{visibleVectorLayers.flatMap((layer) => renderServiceNodes(layer, bounds, w, h))}
```

The projection depends **only** on `layer.geojson` + `query.data.image` (bounds/width/height) — **never** on visibility. So the rendered elements for a layer are stable across toggles and across `showAiModal` changes. Cache them per layer.

**Implementation:**
- Wrap each layer's features + service nodes in a single `<G key={layer.id}>…</G>` (import `G` from `react-native-svg`, already the SVG lib in use here).
- Add a **ref-based per-layer cache** keyed on image identity so each layer is projected **at most once** per data load, computed lazily the first time it's shown, and reused forever after:
  - `const layerGroupCacheRef = useRef<{ key: string; groups: Map<string, React.ReactNode> }>(...)`.
  - Cache key = image identity (e.g. `image.dataUri ?? tiles-signature` + width/height), reset the `Map` when it changes (new property / reacquire).
  - `getLayerGroup(layer)` → return cached node or compute `<G key={layer.id}>{features…}{serviceNodes…}</G>`, store, return.
- In the `<Svg>`: `{visibleVectorLayers.map((layer) => getLayerGroup(layer))}`. A new array each render is fine — the child `<G>` nodes are **referentially stable**, so React reconciles cheaply with **no re-projection**.

**Result:**
- Toggle **OFF** → the layer's `<G>` is dropped; all other layers are cache hits → **instant** (was 5–10s).
- Toggle a layer **ON again** → cache hit → **instant**.
- **Open the AI modal** (`setShowAiModal`) → `visibleVectorLayers` unchanged, all cache hits → SVG re-render is near-free, so the modal appears immediately.

**Make the *first* toggle-ON instant too (optional but recommended):** after the initial map render settles, pre-warm the cache off the critical path so the one-time projection of heavy hidden layers (contours) is already done before the user taps:
- In an effect gated on `query.data` + `canvasSize`, `InteractionManager.runAfterInteractions(() => { for each available vector layer not yet cached, call getLayerGroup(layer); })`. This fills the ref cache in the background (no re-render needed — next show is a hit). Guard with a cancel flag on unmount.

**Do not** move `showAiModal` state or otherwise restructure the card — the memoization makes its re-render cheap, which is sufficient.

---

## Fix #2: make the AI Subdivision popup adaptive to content

**File:** [AiSubdivisionIntroModal.tsx](artifacts/mobile/components/report/AiSubdivisionIntroModal.tsx)

The overlap is caused by two style rules that pin the layout to a fixed budget instead of letting it flow:

- `styles.card` (line 182): **`minHeight: 420`** → remove it. Let the card height be driven by its content (progress dots + icon + copy + actions stack naturally).
- `styles.copyWrap` (line 214): **`flex: 1`** → remove it. The copy block should take its **natural** height; without the flex spacer, the `actions` block sits directly below the copy (with its existing `marginTop`) instead of being pushed into/over it.

Keep everything else: `maxWidth: 420`, paddings, `progressRow`, `iconWrap`, `actions` (`marginTop`), button styles. The `alignItems: "center"` on `card` and centered text remain. Each slide now sizes to its own content, eliminating the slide 3/4 overlap for both the 4-slide (`planning → consultant → upgrade → launch`) and 3-slide sequences.

Optional polish (not required, since user chose *fully* adaptive): a `maxHeight` guard (e.g. `maxHeight: "88%"`) + wrapping `copyWrap` in a `ScrollView` only matters if body copy ever gets very long; current copy is short, so plain flow is enough.

---

## Out of scope (confirmed with user)

The slow **initial** site-plan load for regional addresses like *78 Opaki Road, Masterton* (cold-cache GIS fan-out to slow council servers, `wairarapa`/`wellington` providers) is a **separate, larger server-side effort** (cache warming beyond Auckland canaries, trimming empty/null-geometry regional layers). The user clarified their complaint is the **toggle re-render lag**, not first load, so this plan does **not** touch `site-plan.ts` / `regional-*.ts` / `canaries.ts`. Note it as a possible follow-up.

---

## Files to modify

- [artifacts/mobile/components/report/SitePlanCard.tsx](artifacts/mobile/components/report/SitePlanCard.tsx) — per-layer memoized SVG group cache + `getLayerGroup`; replace inline `flatMap` render at ~844–863; optional deferred pre-warm effect. Import `G` from `react-native-svg`; import `InteractionManager` from `react-native` if pre-warming.
- [artifacts/mobile/components/report/AiSubdivisionIntroModal.tsx](artifacts/mobile/components/report/AiSubdivisionIntroModal.tsx) — remove `minHeight: 420` (line 182) and `flex: 1` (line 214).

No server, i18n, or API changes.

## Verification

Metro/Expo can't be exercised by the browser preview tools, so verify in the running app + by reasoning through the render path:

1. **Toggle speed:** Open the report for **78 Opaki Road, Lansdowne, Masterton** → Plan tab → Site plan card. Toggle **Contours** ON, then OFF, then ON again. Expected: OFF is instant; second ON is instant; first ON is instant if pre-warm is included (otherwise a single brief one-time projection). Repeat for waste water / storm water / potable water.
2. **AI button:** Tap **AI subdivision** — modal should appear with no perceptible delay (no full-map re-projection blocking it). Confirm the map behind it is unchanged.
3. **Popup layout:** Step through all slides (tap **Next**), including slide 3 (`upgrade`, when signed-out/free) and slide 4 (`launch`). Confirm the primary/cancel buttons never overlap the title/body on any slide, and the card resizes to fit each slide. Check both the 4-slide (free/logged-out) and 3-slide (paid) paths, and RTL/Chinese locale (`AI分割生成`) for text-length differences.
4. **Regression:** Confirm default-visible layers still draw on load, pinch/pan still work, and switching between properties resets the layer cache (new image key) so a second property doesn't show the first property's geometry.
5. Run the app's TypeScript check / lint for the two touched files.