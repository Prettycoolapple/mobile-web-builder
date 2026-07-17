# LIM/Title Document Capture & Property-Keyed Document Library

## Context

After a feasibility analysis, the system creates a `lim_title_requests` row and posts a server-generated facilitating DM to the listing agent. Agents reply in a 1:1 chat (mobile app or sales-portal web) and send LIM/title PDFs as **bare file attachments with no property linkage** — the gap: one agent serves many buyers/properties, and one buyer may request 4–5+ properties in a single thread. The goal is a property-keyed cached library of LIM/title docs (business moat) so future requesters get instant delivery, mirroring the cached-feasibility-report pattern.

**Core design decision — capture at source, not sort later.** The strongest correlation signal (thread → open request → propertyKey) exists only at send time and is free. Exploration confirmed the plumbing is already 90% there:
- `lim_title_requests` already carries `propertyKey` (= `normaliseAddressKey()`, the same canonical key as `property_cache`), `propertyAddress`, `dmThreadId`, `requestedDocuments`, status lifecycle.
- `dm_messages` already has `messageKind`, `metadataJson`, `leadRequestId` columns — used today only for the server-generated facilitator/reminder cards.
- The ONLY missing link: `POST /dm/threads/:threadId/messages` doesn't accept `leadRequestId`/doc-type, so agent PDFs land untagged.

A "collect all, sort later" batch pipeline is rejected: it discards the free thread-context signal, then pays LLM tokens + dedup heuristics to reconstruct it.

**User decisions (confirmed):**
1. Serve flow: **instant delivery + still notify agent** (buyer gets cached docs immediately; agent still gets the lead).
2. Consent: **portal T&C clause + one-time upload notice** (blanket, low friction).
3. Rollout: **capture first, serve later** — Phases 1–3 now; Phase 4 (serve-from-cache) is a flagged follow-up.

## Architecture (3 layers, cheapest first)

1. **Structured capture (free, ~90%)** — tag the PDF to a request at attach time via UI in both agent surfaces.
2. **Thread-context attribution (free fallback)** — 1 open request in thread → auto-tag + undo chip; N open → one-tap picker.
3. **Cheap content verification (compute-only, no tokens)** — async job extracts page-1 text, regex-classifies (NZ LIMs/Records of Title are highly templated), verifies address vs `propertyKey`, extracts issue date. LLM only for rare no-text-layer scans (deferred).

Dedup: file hash (S3 single-part PUT ETag = MD5, free via HEAD; sha256 confirmed later by the verification job while it has the bytes).

---

## Phase 1 — Schema + capture + linking UX

### 1a. New table `property_documents` (the moat)

New file `lib/db/src/schema/property_documents.ts` (model on `site_plan_layer_cache.ts` conventions; export from `lib/db/src/schema/index.ts` barrel):

- `id` text PK (uuid)
- `propertyKey` text NOT NULL — `normaliseAddressKey()` output; `propertyAddress` text NOT NULL
- `docType` text NOT NULL: `'lim_report' | 'title' | 'combined'` (combined = one PDF containing both)
- `objectPath` text NOT NULL, `fileUrl` text NOT NULL, `fileName`, `fileMime`, `fileSize` bigint
- `fileHash` text (MD5 from ETag at first; verification job upgrades/records sha256 in `verificationJson`)
- `sourceAgentUserId` → profiles, `sourceRequestId` → lim_title_requests, `sourceMessageId` → dm_messages (all nullable FKs, no cascade — library rows must outlive users, mirroring `property_cache.sourceUserId`)
- `linkMethod` text: `'auto_single_open' | 'agent_picker' | 'card_upload' | 'admin'`
- `verificationStatus` text default `'pending'`: `'pending' | 'text_match' | 'mismatch' | 'no_text_layer' | 'admin_confirmed' | 'rejected'`
- `verificationJson` jsonb (extracted address, title identifier, issue-date string, matched regex markers, sha256)
- `issuedAt` timestamptz (extracted; drives freshness in Phase 4)
- `reuseConsentAt` timestamptz (stamped from the agent's T&C/notice acceptance)
- `supersededById` text (newer doc for same property+type)
- `createdAt`, `updatedAt`
- Indexes: **unique (propertyKey, fileHash)** (dedup — re-upload of identical file no-ops into the library while the per-request delivery is still recorded on the DM message), index (propertyKey, docType), index (sourceRequestId)

Per-request delivery tracking does NOT need a link table: each delivery is the tagged `dm_messages` row (`leadRequestId` + `messageKind`); `property_documents` is the canonical library.

Migration: `lib/db/scripts/add-property-documents-table.mjs` — idempotent (`CREATE TABLE IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`), template `add-site-plan-layer-cache-table.mjs`; register in `lib/db/package.json` scripts. **No auto migration runner — must be run manually before deploy.**

### 1b. API — `artifacts/api-server/src/routes/dm.ts`

- `POST /dm/threads/:threadId/messages`: accept optional `leadRequestId` + `documentType` (`lim_report|title|combined`) on file messages. Validate the request row exists, its `dmThreadId` === thread (or its buyer/agent are the participants) and sender is the agent side. On success set `messageKind: 'lim_title_document'`, `leadRequestId`, `metadataJson: { requestId, docType, propertyKey, propertyAddress }`, then (best-effort, `void`, `withDbRetry` pattern) upsert `property_documents` + fire verification job + run delivery-status derivation (Phase 3 logic). Untagged sends keep working unchanged (backward compat with old clients).
- New `POST /dm/messages/:messageId/tag-document` — retro-tag or re-tag an existing file message (powers the "undo/change" chip and admin fixes). Same validation + same side effects; re-tag moves/updates the library row.
- `GET /dm/threads`: add plural `leads: [...]` per thread (all lim_title_requests joined on `dmThreadId`, with per-doc delivery state); keep existing singular `leadSummary` for old clients.
- New `GET /dm/threads/:threadId/leads` (or fold into messages fetch): open requests for the tag picker — id, propertyAddress, requestedDocuments, per-docType delivered flags.

### 1c. Upload hash — `artifacts/api-server/src/routes/upload.ts`

In `POST /upload/dm-file/complete` (S3 path): HEAD the object → capture size + ETag (single-part presigned PUT ⇒ ETag is content MD5) and return them to the client alongside `fileUrl`; client passes them through in the message payload. Multipart fallback path already has the buffer — hash directly there.

### 1d. Sales portal — `artifacts/api-server/sales-portal/messages.js`

- When the agent attaches a PDF in a thread with ≥1 open (connected, not fully delivered) leads: before send, show a tag sheet — each open request as a row (property address) with chips `LIM / Title / Both`, plus `Other document` (sends untagged). Exactly 1 open request → pre-selected, single confirm tap; after send show an inline "Linked to {address} — change" affordance (calls tag-document).
- Additive: on the existing `lim_title_request` card render per-doc "Attach LIM / Attach Title" buttons → file picker with the tag pre-bound (`linkMethod: 'card_upload'`).
- One-time upload notice (consent model): first tagged upload per agent shows a dismissible notice that documents sent may be shared with other interested buyers of the same property (acceptance stamped; also add the clause to portal T&C copy).
- Thread list: use plural `leads`; "waiting on LIM/title" counter counts undelivered doc types across leads.

### 1e. Mobile agent chat — `artifacts/mobile/app/chat/[threadId].tsx` + `context/DmContext.tsx`

- Same tag-sheet UX on `pickFile`/`confirmSendAttachments` when `user.role === 'sales_agent'` and the thread has open leads (fetch via the new leads endpoint). Extend `sendMessage` payload and the `DmMessage` type (`leadRequestId`, new `messageKind`, metadata). Render `messageKind === 'lim_title_document'` as a small "LIM/Title — {address}" file card on both surfaces (unknown-kind fallback to plain file card already exists).
- Same one-time upload notice for in-app agents.

## Phase 2 — Verification job (no tokens)

New `artifacts/api-server/src/lib/lim-title-doc-verify.ts`, invoked fire-and-forget after a library upsert:

1. Download PDF from storage (`s3StorageService.download` / storage proxy), sha256 the bytes.
2. Extract text of pages 1–2. Check `artifacts/api-server/package.json` for an existing PDF text lib first; if none, add `pdf-parse` (pure JS, serverless-safe). `pdf-lib` (if present) does NOT extract text.
3. Classify: `/LAND\s+INFORMATION\s+MEMORANDUM/i` → lim_report; `/RECORD\s+OF\s+TITLE/i` or `/\bIDENTIFIER\b/ + /\b[A-Z]{1,3}\d{1,6}\/\d{1,6}\b|\b\d{4,9}\b/` near it → title; both → combined. Extract issue date (`Date Issued`, `Search Copy Dated`, dd/mm/yyyy near header) → `issuedAt`.
4. Address check: run candidate address lines through `normaliseAddressKey()` (`artifacts/api-server/src/lib/address-key.ts`) and compare to the request's `propertyKey` (plus token-overlap fallback) → `text_match` or `mismatch`.
5. Statuses: `mismatch` → keep the DM delivery but flag for admin and exclude from Phase 4 serving; no text layer → `no_text_layer` (admin review before serving; optional Haiku vision pass is explicitly deferred).
6. Best-effort discipline: `withDbRetry`, swallow-and-log, never block the send path (site-plan-cache pattern).

## Phase 3 — Delivery automation + admin visibility

- Derivation (shared helper in `artifacts/api-server/src/lib/lim-title-leads.ts`): when every entry of `requestedDocuments` has ≥1 linked doc (`combined` satisfies both), auto-set `lim_title_requests.documentsDeliveredAt`. Manual admin checkbox stays as an override in `routes/admin.ts` (~2518–2742).
- `artifacts/admin-portal/src/pages/LimTitleLeads.tsx`: replace the bare "delivered" checkbox column with per-doc chips (LIM ✓ / Title ✓ + verification badge: pending/verified/mismatch/no-text), plus a small doc list with links (authenticated storage URLs) and a re-tag/reject control (calls tag-document / sets `rejected`).
- Admin also surfaces `verificationStatus = 'mismatch' | 'no_text_layer'` rows as a review queue (simple filter on the same page).

## Phase 4 — Serve-from-cache (follow-up, behind env flag)

Not built now; designed so Phases 1–3 need no rework:

- Flag `LIM_TITLE_SERVE_FROM_CACHE=1`; freshness env vars `LIM_DOC_MAX_AGE_DAYS` (suggest 180) / `TITLE_DOC_MAX_AGE_DAYS` (suggest 90), checked in app code against `issuedAt` (fallback `createdAt`), site-plan-cache style.
- In `routes/lim-title.ts` offer paths (`/offers/evaluate`, `/intent`): before the agent-connection offer, look up `property_documents` by `propertyKey` for fresh + (`text_match` or `admin_confirmed`) docs. On hit: new AI-chat message type `lim_title_documents` (register in `ChatContext.tsx` type union + `ChatBubble.tsx` dispatch, new `components/LimTitleDocumentsBubble.tsx`) rendering doc cards with issue-date disclosure and download via the authenticated storage proxy. **Respect the chat JSON contract** (content stays parseable JSON; render-time guards in ChatBubble).
- Per user decision: still create the lead + facilitator/notify message to the agent, reworded to note docs were already provided ("buyer interested in {address}; we supplied the LIM/title on file"). Request marked delivered immediately.

## Verification (how to test)

1. `node lib/db/scripts/add-property-documents-table.mjs` against local `DATABASE_URL`; typecheck api-server + mobile; run existing api tests (`lim-title-experiment.test.ts` must stay green).
2. E2E capture (local api + sales portal in browser preview): create a lead (or seed a `lim_title_requests` row with `dmThreadId`), log in as the agent in the sales portal, attach a PDF → tag sheet appears; confirm → `dm_messages` row has `leadRequestId`/`messageKind`, `property_documents` row exists, verification job sets `text_match` on a real LIM sample and `mismatch` on a wrong-address sample; admin LimTitleLeads shows chips and auto-delivered state; buyer side (mobile) still renders the file and "File viewed" receipt works.
3. Multi-request thread: seed 2 open requests in one thread → picker lists both; tag each; delivered chips track independently.
4. Backward compat: send an untagged file (old-client shape, no new fields) → behaves exactly as today.
5. Dedup: upload the same PDF twice (renamed) for the same property → one library row, second message still recorded as a delivery.

## Key files

- New: `lib/db/src/schema/property_documents.ts`, `lib/db/scripts/add-property-documents-table.mjs`, `artifacts/api-server/src/lib/lim-title-doc-verify.ts`
- Modified: `lib/db/src/schema/index.ts`, `lib/db/package.json`, `artifacts/api-server/src/routes/dm.ts`, `artifacts/api-server/src/routes/upload.ts`, `artifacts/api-server/src/lib/lim-title-leads.ts`, `artifacts/api-server/sales-portal/messages.js`, `artifacts/mobile/app/chat/[threadId].tsx`, `artifacts/mobile/context/DmContext.tsx`, `artifacts/admin-portal/src/pages/LimTitleLeads.tsx`, `artifacts/api-server/src/routes/admin.ts`
- Phase 4 (later): `artifacts/api-server/src/routes/lim-title.ts`, `artifacts/mobile/context/ChatContext.tsx`, `artifacts/mobile/components/ChatBubble.tsx`, new `LimTitleDocumentsBubble.tsx`

## Edge cases handled

- Same buyer, many properties, one thread → plural `leads` + picker.
- Same property, different buyers/threads, same agent → dedup on (propertyKey, fileHash); each delivery tracked on its own DM message.
- Combined LIM+title PDF → `docType: 'combined'` satisfies both requested docs.
- Non-LIM/title PDFs (e.g. sale & purchase agreement) → "Other document" sends untagged, never enters the library.
- Scanned/no-text PDFs → `no_text_layer`, admin review queue; LLM/vision fallback deferred.
- Old app versions → all new fields optional; `leadSummary` retained alongside `leads`.