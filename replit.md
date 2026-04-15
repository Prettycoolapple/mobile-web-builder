# Lecorb

## Overview

Lecorb is an AI-powered mobile application designed to provide New Zealand real estate development feasibility analysis. Built with Expo (React Native) for the mobile front-end and an Express.js API server, it aims to assist users in making informed property development decisions. The application integrates advanced AI capabilities, real-time data scraping, and a robust data pipeline to generate comprehensive feasibility reports. Its core purpose is to simplify complex property analysis, offering features like address-specific reports, discovery searches for subdividable properties, and conversational AI for follow-up questions. The project seeks to address market needs for accessible and accurate real estate development insights in New Zealand.

## User Preferences

I prefer iterative development, with a focus on clear communication and explanations at each step. Please ask before making major architectural changes or decisions that impact the user experience significantly. I value well-documented code and a logical, maintainable project structure.

## System Architecture

The application is built as a monorepo utilizing `pnpm workspaces`.

**Mobile Application (Expo/React Native)**
- **Navigation:** `expo-router` handles authentication flows and tab-based navigation. Tabs: Search, Messages, History, Account. Chat screens at `app/chat/contacts.tsx` and `app/chat/[threadId].tsx`.
- **State Management:** `AuthContext` manages user authentication state and JWT persistence. `ChatContext` handles AI chat/session states. `DmContext` manages real-time DM Socket.io connection, thread list, and unread count badge.
- **UI Components:** Key components include `FeasibilityReport` for rendering comprehensive analysis, `ScoreRing` for animated SVG progress, and `AccordionSection` for collapsible content. Design tokens are defined in `constants/colors.ts` with a warm cream palette and specific accent colors.
- **Theming:** A `useColors()` hook manages light/dark mode based on `constants/colors.ts`.
- **Subscription UI:** `PaywallModal` and `Profile` screens integrate with subscription management, displaying usage and upgrade options. `AnalysisProgress` provides animated step-by-step loading for analysis.

**API Server (Express.js)**
- **Authentication:** JWT-based authentication with `scrypt` for password hashing. `requireAuth` middleware protects routes.
- **Core Endpoints:** Dedicated routes for user authentication (`/auth`), search history management (`/searches`), and the primary analysis/chat functionalities (`/analyse`, `/search`, `/chat`). A debug endpoint (`/pipeline-test`) exists for raw pipeline output.
- **AI Integration:** Uses Gemini 2.5 Pro via Replit AI Integrations. A custom `claude.ts` wrapper provides `generateUnifiedResponse()` and `detectMode()`. Prompts are managed in `prompts.ts`.
- **Data Pipeline (Phase 3 + 4):** A critical component for data collection and scoring.
    - **Data Collection:** Parallelized fetching from multiple sources including:
        - Address parsing (`address-parser.ts`)
        - Geocoding (`geocode.ts` using Nominatim/Google Maps)
        - LINZ API for parcel and title data (`linz.ts`)
        - Auckland Council GIS for zoning, overlays, and contour data (`auckland-council.ts`)
        - Property data from Auckland Council rating GIS and QV (`property-data.ts`)
        - Infrastructure data (`infrastructure.ts`)
        - Web scrapers (`scrapers/` directory) for Hougarden, OneRoof, Homes, and QV, employing Playwright with stealth evasion and ScrapingBee as fallback.
    - **Data Merging:** `mergePropertyData()` consolidates information from various sources, tracking data sources and missing critical fields.
    - **Scoring Engine (Phase 4):** Deterministically calculates:
        - Asbestos risk (`asbestos.ts`)
        - Potential lot subdivision (`lot-calculator.ts`)
        - Detailed cost estimations (`cost-estimator.ts`)
        - Comparable sales data (`comparables.ts`)
        - ROI scenarios (Bear, Base, Bull) across different time horizons (`roi-calculator.ts`), influenced by RBNZ OCR direction via Gemini Flash.
        - Overall property scoring (Ease, Cost, ROI) (`scoring.ts`).
    - **Orchestration:** `pipeline.ts` orchestrates the entire data collection, merging, and scoring process, including a sophisticated fallback chain for property data scrapers.
- **Database:** PostgreSQL with Drizzle ORM. Schema includes `profiles` (users), `searches` (history), `conversations`, `messages`, `dm_threads`, `dm_messages`, `push_tokens`.
- **Direct Messaging:** Full DM REST API at `/api/dm/*` (contacts, threads, messages, read receipts, push tokens). Socket.io integrated with JWT auth at path `/api/socket.io` for real-time messaging. Expo push notification dispatch for offline users.
- **File Uploads:** `POST /api/upload/dm-image` for image sharing in DM threads (stored in object storage).

**Real Listing Pipeline (Discovery Mode)**
- **Primary Source:** realestate.co.nz (static HTML scraping).
- **Pre-screening:** Fast pre-screening using geocoding and Auckland Council GIS zone lookup.
- **Caching:** In-memory caching for `ListingResult[]` with a 30-minute TTL to optimize follow-up searches.
- **Filtering:** Excludes apartments and filters by price. Listing URLs are validated against suburb slugs.
- **Fallback:** Mock data is used when no listings are found or the suburb is not mapped.

**Design System**
- **Typography:** DM Sans font.
- **Color Palette:** Warm cream background (`#FAF9F6`), dark charcoal header (`#1C1917`), Anthropic orange accent (`#D97757`), with distinct colors for success, amber, and danger states.

## External Dependencies

- **AI:** Gemini 2.5 Pro (via Replit AI Integrations), Gemini 2.5 Flash.
- **Database:** PostgreSQL.
- **ORM:** Drizzle ORM.
- **Authentication:** `jsonwebtoken` for JWTs, Node.js built-in crypto for `scrypt`.
- **Validation:** Zod (`zod/v4`) and `drizzle-zod`.
- **API Codegen:** Orval (from OpenAPI spec).
- **Mapping/Geocoding:** Nominatim (OSM), Google Maps API.
- **GIS Data:** LINZ API, Auckland Council GIS (`mapspublic.aucklandcouncil.govt.nz/arcgis3`).
- **Elevation Data:** AWS Terrarium terrain tiles, Google Elevation, Open-Topo-Data (nzdem8m), Open-Elevation API.
- **Web Scraping:** Playwright (with stealth evasion), ScrapingBee API, Cheerio.
- **Payment Processing:** Stripe (for web checkout and webhooks), RevenueCat (for native in-app purchases on iOS/Android).
- **Mobile Development:** Expo, `expo-router`, `react-native-svg`, `react-native-purchases`.