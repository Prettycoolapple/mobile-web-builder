# DevFeasible NZ

## Overview

AI-powered NZ real estate development feasibility analysis mobile app built with Expo (React Native) and an Express API server.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Mobile**: Expo (React Native), expo-router
- **API framework**: Express 5
- **AI**: Gemini 2.5 Pro via Replit AI Integrations (no API key needed)
- **Database**: PostgreSQL + Drizzle ORM
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
- `artifacts/mobile/app/(tabs)/index.tsx` — Main chat screen (Analyse)
- `artifacts/mobile/app/(tabs)/history.tsx` — Session history
- `artifacts/mobile/app/(tabs)/profile.tsx` — Profile & subscription
- `artifacts/mobile/context/ChatContext.tsx` — Global chat/session state with AsyncStorage persistence
- `artifacts/mobile/components/FeasibilityReport.tsx` — Full report renderer with collapsible sections
- `artifacts/mobile/components/PropertyCard.tsx` — Discovery result card
- `artifacts/mobile/components/ChatBubble.tsx` — Chat message bubble (text/report/search)
- `artifacts/mobile/components/ScoreBadge.tsx` — Circular score badge (Ease/Cost/ROI)
- `artifacts/mobile/components/OverlayChip.tsx` — Planning overlay status chip
- `artifacts/mobile/constants/colors.ts` — Design tokens (navy/emerald/amber/red palette)

### API Server (Express)
- `artifacts/api-server/src/routes/analyse.ts` — `/analyse`, `/search`, `/chat` endpoints
- `artifacts/api-server/src/lib/claude.ts` — Gemini 2.5 Pro AI calls (named claude.ts for legacy)

## Color Palette
- Deep navy: `#0F172A` — headers/primary backgrounds
- Emerald: `#10B981` — positive scores, CTAs
- Amber: `#F59E0B` — moderate/warning
- Red: `#EF4444` — high risk/restricted
- Background: `#F8FAFC`

## Features
1. **Address Analysis** — Type A: Analyse specific NZ property addresses
2. **Discovery Search** — Type B: Find subdividable properties by suburb/price
3. **Feasibility Report** — Scores (Ease/Cost/ROI), planning overlays, terrain, infrastructure, cost breakdown, ROI scenarios, comparable sales, AI risk summary
4. **Session History** — AsyncStorage-persisted chat sessions
5. **Profile & Subscription** — Free (3 reports/month) vs Pro ($49/month NZD)
6. **Follow-up Chat** — Maintains conversation context per session

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
