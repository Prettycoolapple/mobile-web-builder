# DevFeasible NZ

## Overview

AI-powered NZ real estate development feasibility analysis mobile app built with Expo (React Native) and an Express API server. Requires login to access chat and analysis features.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Mobile**: Expo (React Native), expo-router
- **API framework**: Express 5
- **AI**: Gemini 2.5 Pro via Replit AI Integrations (no API key needed)
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: JWT (jsonwebtoken) + scrypt password hashing (built-in Node.js crypto)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## App Structure

### Mobile (Expo)

**Auth screens** (redirect to tabs after login):
- `artifacts/mobile/app/(auth)/_layout.tsx` — Auth stack layout
- `artifacts/mobile/app/(auth)/login.tsx` — Login screen
- `artifacts/mobile/app/(auth)/signup.tsx` — Signup screen

**Tabs** (protected — requires auth):
- `artifacts/mobile/app/(tabs)/index.tsx` — Main chat screen (Analyse/Search/Chat)
- `artifacts/mobile/app/(tabs)/history.tsx` — Session history (only shows sessions with messages)
- `artifacts/mobile/app/(tabs)/profile.tsx` — Profile, subscription, real usage counter, sign-out

**Context / State**:
- `artifacts/mobile/context/AuthContext.tsx` — User auth state, JWT token, AsyncStorage persistence
- `artifacts/mobile/context/ChatContext.tsx` — Global chat/session state with AsyncStorage persistence

**Components**:
- `artifacts/mobile/components/FeasibilityReport.tsx` — Full report renderer with collapsible sections
- `artifacts/mobile/components/PropertyCard.tsx` — Discovery result card
- `artifacts/mobile/components/ChatBubble.tsx` — Chat message bubble (text/report/search)
- `artifacts/mobile/components/ScoreBadge.tsx` — Circular score badge (Ease/Cost/ROI)
- `artifacts/mobile/components/OverlayChip.tsx` — Planning overlay status chip
- `artifacts/mobile/constants/colors.ts` — Design tokens (warm cream palette + danger alias)

### API Server (Express)

- `artifacts/api-server/src/routes/auth.ts` — `/auth/signup`, `/auth/login`, `/auth/me`, `/auth/profile`
- `artifacts/api-server/src/routes/analyse.ts` — `/analyse`, `/search`, `/chat` (unified endpoint; analyse mode runs full pipeline before AI)
- `artifacts/api-server/src/routes/pipeline-test.ts` — Debug endpoint: `GET /api/pipeline-test?address=...` returns raw pipeline JSON
- `artifacts/api-server/src/lib/claude.ts` — Gemini AI wrapper with `generateUnifiedResponse()` + exported `detectMode()`
- `artifacts/api-server/src/lib/prompts.ts` — SYSTEM_PROMPT + ANALYSE_AUGMENTATION + DISCOVER_AUGMENTATION
- `artifacts/api-server/src/lib/auth.ts` — JWT signing/verification, requireAuth middleware, password hashing

### Phase 3 + 4 Pipeline (`artifacts/api-server/src/lib/`)

**Data collection** (run in parallel via `Promise.allSettled()`):
- `address-parser.ts` — `extractNZAddress()`: regex first-pass + Gemini fallback to extract NZ street addresses from free text
- `geocode.ts` — `geocodeAddress()`: Nominatim (OSM) primary, Google Maps fallback (needs `GOOGLE_MAPS_API_KEY`); `GeoResult` now includes `suburb: string | null` from Nominatim's `address.suburb` field
- `linz.ts` — `fetchLINZParcel()` + `fetchLINZTitle()`: LINZ API layer 50804 (needs `LINZ_API_KEY`)
- `auckland-council.ts` — `fetchUnitaryPlanZone()` + `fetchOverlays()` + `fetchContour()`: Auckland Council GIS at `mapspublic.aucklandcouncil.govt.nz/arcgis3`
  - Zone service: `NonCouncil/UnitaryPlanZones/MapServer/1` (56-code numeric domain map)
  - Overlays: layers 33 (heritage), 19 (notable trees, 30m buffer), 25/27 (viewshafts), 58 (coastal inundation), 24 (Waitakere), 29 (ridgeline)
- `property-data.ts` — `fetchPropertyHistory()` + `checkAsbestosRisk()`: Auckland Council rating GIS + QV fallback; asbestos risk by build year
- `infrastructure.ts` — `fetchInfrastructure()`: stormwater/wastewater/water supply distance from parcel
- `scrapers/browser.ts` — `launchBrowser()` + `newStealthPage()`: NixOS system Chromium with full stealth evasion; `withBrowserSlot()` (max 2 concurrent)
- `scrapers/scrapingbee.ts` — `fetchWithScrapingBee()`: ScrapingBee API fallback; silently skips if `SCRAPINGBEE_API_KEY` not set
- `scrapers/hougarden.ts` — `scrapeHougarden()`: 3-attempt chain: stealth Playwright → ScrapingBee+cheerio → empty
- `scrapers/oneroof.ts` — `scrapeOneRoof()`: same 3-attempt chain
- `scrapers/merge.ts` — `mergePropertyData()`: priority-merges all sources; now includes `contour`, `asbestos_risk`, `infrastructure` in `MergedPropertyData`

**Phase 4 scoring engine** (deterministic, no AI, runs after merge):
- `asbestos.ts` — `classifyAsbestos(build_year)`: returns `{ risk, notes, worksafe_required }` with full WorkSafe NZ legal context
- `lot-calculator.ts` — `calculatePotentialLots(area, zone)`: AUP min lot sizes per zone, capped 1–20 lots
- `cost-estimator.ts` — `estimateCosts(merged, units)`: full breakdown — land CV + demo + retaining + services + construction (2800–3500/m²) + consents (13–16%) + finance (7.5%pa) + contingency (8–12%)
- `comparables.ts` — `getComparables(suburb, zone, lat, lng, existing?)`: uses live OneRoof comparables if ≥3, otherwise suburb lookup table (20 Auckland suburbs + default) with synthetic comparables
- `roi-calculator.ts` — `calculateROIScenarios(costs, avgPrice, units)`: 3 scenarios (2/3/4 years), compound annualised ROI
- `scoring.ts` — `scoreProperty(merged, costs, scenarios, lots)`: ease (deductions from 5.0), cost (bracket), ROI (bracket); composite = ease×0.30 + cost×0.30 + roi×0.40
- `utils.ts` — `formatNZD()`, `extractSuburb()`, `roundToHalf()`, `clamp()`
- `pipeline.ts` — `runPropertyPipeline()`: orchestrates all; ~10s total; result includes `lots`, `costs`, `comparables`, `comparables_quality`, `scenarios`, `scores`, `asbestos_detail`, `suburb`

### Database Schema (`lib/db/src/schema/`)

- `profiles.ts` — Users table (id, email, full_name, password_hash, subscription_tier, reports_used_this_month, last_reset_at, stripe_customer_id)
- `searches.ts` — Search/analysis history (id, user_id FK, query, address, result_json, created_at)
- `conversations.ts` — Conversation sessions
- `messages.ts` — Chat messages

## Auth Flow

1. App loads → checks `AuthContext` (reads JWT from AsyncStorage)
2. No token → redirected to `/(auth)/login`
3. Login/signup → JWT stored in AsyncStorage → redirected to `/(tabs)`
4. All API calls to `/api/analyse`, `/api/search` include `Authorization: Bearer <token>` header
5. Free tier: 3 reports/month enforced server-side → returns 402 with `LIMIT_REACHED` code
6. Monthly counter resets automatically when a new calendar month begins

## Design System

- **Font**: DM Sans (400/500/600/700)
- **Background**: `#FAF9F6` (warm cream)
- **Header**: `#1C1917` (dark charcoal)
- **Accent**: `#D97757` (Anthropic orange) — buttons, tabs, logo mark, send arrow
- **Success**: `#2E9E72`, **Amber**: `#E8A84B`, **Red/Danger**: `#D94F4F`
- `useColors()` hook auto-switches light/dark from `constants/colors.ts`

## Features

1. **Address Analysis** — Analyse specific NZ property addresses with full feasibility reports
2. **Discovery Search** — Find subdividable properties by suburb/price criteria
3. **Feasibility Report** — Scores (Ease/Cost/ROI), planning overlays, terrain, infrastructure, cost breakdown, ROI scenarios, comparable sales, AI risk summary
4. **Session History** — AsyncStorage-persisted chat sessions (only non-empty sessions shown)
5. **Profile & Subscription** — Free (3 reports/month) vs Pro ($49/month NZD), real usage counter from DB
6. **Follow-up Chat** — Maintains conversation context per session
7. **Auth** — Email/password auth with JWT, protected routes, sign-out

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
