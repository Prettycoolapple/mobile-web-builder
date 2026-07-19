# LIM/Title Phase 4 — serve-from-cache, wrong-doc cleanup, AI-reworded facilitator copy

## Context

The Message Hub chats look unstructured, but under the hood every one of those "Could you please send me the LIM report and title?" messages is already a structured lead: Phases 1–3 of [plan/lim-title1.md](D:\apps\Mobile-Web-Builder\plan\lim-title1.md) shipped in build 2.17. Direct answers to the four questions that prompted this plan:

1. **How do agent-dropped PDFs archive to the right address?** Already built. Each request card carries `leadRequestId` + `propertyKey` (= `normaliseAddressKey(address)`, the same canonical key as `property_cache`). Agents tag at send time (Attach LIM / Attach Title buttons on the card in mobile, tag sheet + "change link" retro-tag in the sales portal); `captureLimTitleDocument` upserts into the canonical `property_documents` library, and an async job verifies the PDF's page-1 text against the address (`text_match` / `mismatch` / `no_text_layer`).
2. **Does Cici re-send for a second buyer of the same address?** Today yes — Phase 4 (serve-from-cache) was deferred. **This plan builds it**: verified fresh docs are delivered instantly at consent; Cici still gets the lead, with a reworded facilitator card ("supplied from the document library — no action needed") and the served files mirrored into her thread.
3. **Wrong-address uploads?** Partially built (re-tag, admin reject, auto mismatch-flagging). **This plan completes "correct + notify"**: rejecting/re-tagging retracts any cache-served copies, posts a correction note to affected buyers (with replacement doc when one exists), and un-stamps delivery.
4. **Hardcoded facilitating messages?** **This plan adds LLM rewording** (same meaning, per-message variation, hard guards, static fallback) for the three LIM/title messages.

**Confirmed product decisions** (user-approved): platform-wide reuse (any verified fresh doc for the address, matching the reuse notice agents already accept — sales-portal/index.html:914); docs mirrored in-thread + reworded facilitator; LLM rewording for buyer request card + reminder ping + cache-served agent note only (NOT provider-connect intros); cleanup = correct + notify (no bubble redaction — audit trail stays).

**Constraints**: Vercel serverless (no in-memory state; `ENABLE_SOCKET_IO=false` in prod → pushes matter); no auto DB migrations (this plan needs **zero schema changes** — everything rides existing `metadata_json` columns); chat JSON contract (never LLM-process structured payloads; `metadataJson` stays machine truth); old app builds must degrade gracefully (unknown `messageKind` → body-text fallback already exists).

## metadataJson contracts (type-only, no migration)

- `lim_title_requests.metadataJson` gains:
  - `facilitatorCopy?: { requestBody?; reminderBody?; servedNote?; generatedAt? }` — pre-generated LLM copy stash
  - `cacheServe?: { servedAt, items: [{ propertyDocumentId, docType, servesTypes, fileUrl, fileName, fileMime, issuedAt, retractedAt? }] }` — durable serve record (works even before a DM thread exists)
  - `deliveredVia?: "derived" | "admin_manual"` — provenance so auto-unstamp never clears a manual admin stamp
- Mirror `dm_messages.metadataJson`: `{ requestId, docType, servesTypes, propertyKey, propertyAddress, servedFromCache: true, propertyDocumentId, retractedAt?, retractedReason? }`; served facilitator adds `servedFromCache: true, servedDocTypes`. New kinds: `lim_title_correction` (and mirrors reuse existing `lim_title_document`).
- Cleanup lookup is a jsonb filter (`metadata_json->>'propertyDocumentId'`) — rare admin-triggered action, seq scan fine; an optional expression-index `add-*.mjs` script can come later if volume warrants.

## Implementation steps (ordered; each independently deployable)

### Step 1 — Server core: flags, doc selection, delivery recompute (dark)

- [env.ts](artifacts/api-server/src/lib/env.ts): `isLimTitleServeFromCacheEnabled()` (`LIM_TITLE_SERVE_FROM_CACHE`, default off), `getLimDocMaxAgeDays()` (180), `getTitleDocMaxAgeDays()` (90) — follow the `isLimTitleSmsEnabled` pattern.
- **New** `artifacts/api-server/src/lib/lim-title-serve.ts`:
  - `selectServableDocuments(docs, neededTypes, now, ages)` — **pure**: keep `verificationStatus ∈ (text_match, admin_confirmed)`, `supersededById IS NULL`, `reuseConsentAt` set; per-use freshness (`issuedAt ?? createdAt`; a `combined` older than the title window but inside the LIM window serves only `lim_report`); newest per needed type.
  - `findServableLimTitleDocuments(propertyKey, neededTypes)` — DB fetch + selector; `buildMirrorMessageValues`, `buildServedDocumentDto`, `markCacheServed(requestId, items)` (jsonb-merge `cacheServe`, then re-derive), `planCacheServeMirrors(request, libraryRows)` (pure; claim-time replay, drops since-rejected docs).
- [lim-title-leads.ts](artifacts/api-server/src/lib/lim-title-leads.ts) delivery derivation:
  - `deliveredTypesFromMessages` (line ~37): skip rows with `metadataJson.retractedAt`; honour `servesTypes`.
  - `getLimTitleDeliveryState` (~52): union non-retracted `cacheServe.items` into delivered set (extract pure `computeDeliveredTypes` for tests).
  - `deriveLimTitleDeliveryStatus` (~73): stamp **and un-stamp** — complete → coalesce-stamp + `deliveredVia:'derived'` when previously null; incomplete → clear `documentsDeliveredAt` **only** where `deliveredVia = 'derived'` (legacy/manual stamps never auto-clear).
  - [admin.ts](artifacts/api-server/src/routes/admin.ts) manual delivered checkbox (~2800–2854): write/strip `deliveredVia:'admin_manual'`.

### Step 2 — LLM copy util (dark)

**New** `artifacts/api-server/src/lib/lim-title-copy.ts`, call pattern copied from [translation.ts](artifacts/api-server/src/lib/translation.ts) (`ai.models.generateContent`, `deepseek-chat`, `thinkingBudget: 0`, temperature ~1.1, maxOutputTokens 160):

- `buildStaticLimTitleCopy(kind, args)` — deterministic templates; full request delegates to existing `buildLimTitleFacilitatorMessage` (keeps existing tests green); partial asks only for missing types; reminder has an `alreadyDelivered` "any updated versions?" variant; served note = "…supplied from Project Alpha's document library, so no action is needed — feel free to attach updated versions."
- `guardLimTitleCopy(raw)` — reject when empty / >320 chars / address not verbatim (whitespace-normalised, case-insensitive) / URLs / emoji / `{}[]<>`/backticks / multi-paragraph → null.
- `generateLimTitleCopy(kind, args, { timeoutMs: 2500 })` — system prompt: rewrite one short chat message, same meaning, vary phrasing, address verbatim, plain text, no links/emojis/quotes, invent nothing. `Promise.race` timeout; errors → null; output guarded. **Never inside a DB transaction.**
- `resolveLimTitleCopy(request, kind, args, { allowGenerate })` — stash (variant-matched + guarded) ?? bounded generate ?? static.
- `preGenerateLimTitleOfferCopy(request)` — background `Promise.allSettled` of the three kinds; single concurrency-safe top-level jsonb `||` merge. Fired `void` from both offer routes in [lim-title.ts](artifacts/api-server/src/routes/lim-title.ts) after `createOrReuseLimTitleOffer`.
- **Fix the clobber**: `createOrReuseLimTitleOffer` revive-declined branch (lim-title-leads.ts ~317–338) must spread `...(existing.metadataJson ?? {})` instead of replacing `metadataJson`.

Latency: stash hit = 0ms (normal — offer→consent is human-speed); miss ≤2.5s; LLM down → static.

### Step 3 — Serve flow (behind flag)

- `connectLimTitleRequest(requestId, options?: { servePlan?, facilitatorBody? })`:
  - **Narrow the facilitator idempotency select** (~427–431) with `eq(dmMessages.messageKind, 'lim_title_request')` — today it matches any `leadRequestId` row and would collide with mirrors.
  - Facilitator body = `options.facilitatorBody ?? stash ?? static`, variant chosen by served state (all-served → served note; partial → partial request; none → full request); add `servedFromCache` metadata when serving.
  - When the facilitator is **newly inserted** and a serve plan exists (passed in, or rebuilt from `metadataJson.cacheServe` on the claim path), insert one mirror `lim_title_document` message per served doc in the same tx (`senderId` = buyer; body "Sent via Project Alpha document library: LIM report — {address}"; file fields from the library row; **no** `captureLimTitleDocument` — the doc already is the library row). Mirrors only alongside a first-time facilitator insert ⇒ re-requests/claim retries never duplicate.
  - Emit sockets per inserted message; **add the missing Expo push to the agent** (`sendPushToUser` + `getUnreadAppBadgeCount`, copying the pattern in [dm.ts](artifacts/api-server/src/routes/dm.ts) ~512–534): served → "LIM/title for {address} shared from our document library — no action needed", else facilitator preview.
- `consentToLimTitleRequest` fresh branch (~596): flag-gated `findServableLimTitleDocuments` → resolve copy (bounded, outside tx) → connect with options → `markCacheServed` (also when NOT connected — pending_agent_claim serves via `cacheServe` and stamps delivery with no thread; claim-time `claimOutstandingLimTitleLeads → connectLimTitleRequest` replays mirrors + served facilitator, stash-or-static copy only). Return `servedDocuments` DTOs.
- Re-request branch (~561): when already delivered, reminder **rewords** ("I already have the LIM and title for {address}; could you send any updated versions?") via `resolveLimTitleCopy` — never "still hoping to get"; add the missing agent push here too.
- Consent route response gains `servedDocuments` + `deliveryComplete` (additive; old apps ignore).

### Step 4 — Cleanup cascade ("correct + notify")

**New** `artifacts/api-server/src/lib/lim-title-cleanup.ts` — `cascadePropertyDocumentRetraction({ propertyDocumentIds, reason: 'rejected' | 'retagged' })`, fire-and-forget, `withDbRetry` + swallow-and-log:

1. Find non-retracted served mirrors (`message_kind='lim_title_document'` + jsonb `propertyDocumentId`) and affected requests (mirror `leadRequestId` ∪ requests whose `cacheServe.items` reference the doc — covers no-thread serves).
2. Mark mirrors `retractedAt`/`retractedReason` (bubble kept for audit) → emit `message_updated`; mark matching `cacheServe.items[]` entries.
3. Per affected request with a thread: insert `lim_title_correction` (senderId = buyer, **static copy** — not an LLM message): "Correction: the {LIM report/title} previously shared for {address} … was linked to the wrong property and has been withdrawn." If a servable replacement exists → "The correct document is attached below." + fresh mirror (recorded into `cacheServe`).
4. `deriveLimTitleDeliveryStatus` for every affected request (un-stamps derived-only stamps).
5. Socket + push both participants ("Document update — {address}").

Trigger wiring:
- [admin.ts](artifacts/api-server/src/routes/admin.ts) PATCH `/admin/property-documents/:documentId` (~2856–2929): on `rejected` or retag → `void cascade(...)`; **also fix**: snapshot the document's previous `sourceRequestId` and re-derive it (today only the new request is re-derived, leaving the old request's stamp stale).
- [dm.ts](artifacts/api-server/src/routes/dm.ts) `POST /dm/messages/:messageId/tag-document` + [lim-title-documents.ts](artifacts/api-server/src/lib/lim-title-documents.ts): `replaceExistingForMessage` delete gets `.returning({ id })`; after upsert, cascade the deleted ids (excluding the new row id) and re-derive `previousRequestId` when it differs. Skip everything when the tag didn't change.

### Step 5 — Mobile buyer AI-chat (app release)

- [ChatContext.tsx](artifacts/mobile/context/ChatContext.tsx): add `"lim_title_documents"` to the type union (~line 48) + `limTitleServedDocuments` field + persistence guard case (~741–753).
- [(tabs)/index.tsx](artifacts/mobile/app/(tabs)/index.tsx) `confirmLimTitleConsent` (~1189–1227): read `servedDocuments`; append a `lim_title_documents` assistant message (content stays `""` — chat JSON contract untouched); consent modal served variant ("we've shared the documents with you now — they're also in your Messages").
- **New** `artifacts/mobile/components/LimTitleDocumentsBubble.tsx` + dispatch branch in [ChatBubble.tsx](artifacts/mobile/components/ChatBubble.tsx) (~327): card per doc — type label, fileName, "Issued {date}" disclosure, "From Project Alpha's document library", tap → authenticated download/share. Extract `openDmFile`/`resolveDmStoredImageUri` from [chat/[threadId].tsx](artifacts/mobile/app/chat/[threadId].tsx) into shared **`artifacts/mobile/lib/dmFiles.ts`**.

### Step 6 — Mobile DM + sales portal rendering

- [chat/[threadId].tsx](artifacts/mobile/app/chat/[threadId].tsx): `lim_title_request` branch (~1284) — served-variant chrome when `metadataJson.servedFromCache` ("Documents supplied from our library — no action needed; you can still attach updated versions"), attach buttons kept; `lim_title_document` (~1373) — "· Project Alpha library" suffix, dimmed + "Withdrawn — wrong property" badge when `retractedAt`; new `lim_title_correction` info-card branch.
- [sales-portal/messages.js](artifacts/api-server/sales-portal/messages.js) `messageContent` (~207–283): same three additions + small CSS.

### Step 7 — Admin polish

- [admin.ts](artifacts/api-server/src/routes/admin.ts) lead list (~2696–2744): resolve delivery docs by `propertyDocumentId` (ahead of the hash fallback); pass `servedFromCache`/`retractedAt` through.
- [LimTitleLeads.tsx](artifacts/admin-portal/src/pages/LimTitleLeads.tsx): delivered chips skip retracted docs; "library ×N" badge; "withdrawn" state.
- [MessageHub.tsx](artifacts/admin-portal/src/pages/MessageHub.tsx) (~428–439): minimal kind label chips ("Request card" / "Library document" / "Correction").

## Files

- **New**: `artifacts/api-server/src/lib/lim-title-serve.ts`, `lim-title-copy.ts`, `lim-title-cleanup.ts`; `artifacts/mobile/components/LimTitleDocumentsBubble.tsx`; `artifacts/mobile/lib/dmFiles.ts`
- **Modified**: `artifacts/api-server/src/lib/{env,lim-title-leads,lim-title-documents}.ts`, `artifacts/api-server/src/routes/{lim-title,dm,admin}.ts`, `artifacts/api-server/sales-portal/messages.js`, `artifacts/mobile/context/ChatContext.tsx`, `artifacts/mobile/components/ChatBubble.tsx`, `artifacts/mobile/app/(tabs)/index.tsx`, `artifacts/mobile/app/chat/[threadId].tsx`, `artifacts/admin-portal/src/pages/{LimTitleLeads,MessageHub}.tsx`
- **Migrations: none.**

## Verification

Unit (vitest in `artifacts/api-server`, mock `@workspace/db` + `@workspace/integrations-gemini-ai` per existing `lim-title-leads.test.ts`):
- `lim-title-serve.test.ts` — selection filters (status/superseded/consent), per-type freshness with `issuedAt ?? createdAt`, newest-per-type, combined satisfies both / stale-for-title-only; `planCacheServeMirrors` drops rejected.
- `lim-title-copy.test.ts` — guard matrix (address verbatim, URL/emoji/brace rejection, length, quote-strip); fallback chain (stash mismatch → generate → static; timeout → static); static templates per kind/variant.
- `lim-title-delivery.test.ts` — `computeDeliveredTypes` with retracted mirrors + `cacheServe`; un-stamp gating (derived vs admin_manual vs legacy).
- Existing `lim-title-leads.test.ts` / `lim-title-experiment.test.ts` stay green (full-request static template unchanged).

E2E (local API + portals via browser preview, flag on): (1) seed two verified fresh docs → new buyer consent → response carries `servedDocuments`, thread shows served facilitator + mirrors, `documentsDeliveredAt` stamped `derived`, agent push/socket fired; (2) partial hit → facilitator asks only for the missing doc, agent attach completes delivery; (3) pending_agent_claim → serve at consent, agent signup → thread replays served facilitator + mirrors; (4) admin reject → mirrors withdrawn, correction posted (+replacement when available), delivery un-stamped, admin chips update; repeat via agent "Change link" re-tag; (5) old-client shape renders mirrors/corrections as plain file/text; (6) **flag off → behaviour byte-identical to today**; (7) `pnpm run ci` in api-server; typecheck mobile + admin-portal.

Deploy order: Steps 1–2 (dark) → 3 (flag off → staging on) → 4 → 6-portal + 7 (server-served surfaces) → 5 + 6-mobile in the next app release. No DB migration gates anything.