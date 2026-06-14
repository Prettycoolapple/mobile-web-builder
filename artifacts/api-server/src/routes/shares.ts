import { Router, type Request, type Response } from "express";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import crypto from "node:crypto";
import { z } from "zod";
import { db, propertyShares } from "@workspace/db";
import { verifyActiveToken } from "../lib/auth";
import { getAndroidPlayStoreUrl, getIosAppStoreUrl, getPublicAppUrl } from "../lib/env";

const router = Router();

const selectedListingContextSchema = z.object({
  address: z.string().optional().nullable(),
  listingUrl: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  photoUrls: z.array(z.string()).optional().nullable(),
  price: z.number().optional().nullable(),
  landArea: z.number().optional().nullable(),
  floorArea: z.number().optional().nullable(),
  bedrooms: z.number().optional().nullable(),
  bathrooms: z.number().optional().nullable(),
  bedroomsApprox: z.boolean().optional().nullable(),
  bathroomsApprox: z.boolean().optional().nullable(),
  landAreaApprox: z.boolean().optional().nullable(),
  floorAreaApprox: z.boolean().optional().nullable(),
  priceApprox: z.boolean().optional().nullable(),
  source: z.string().optional().nullable(),
  isCombinedListing: z.boolean().optional().nullable(),
  packageAddress: z.string().optional().nullable(),
  childAddresses: z.array(z.string()).optional().nullable(),
  aggregateFactsExcluded: z.boolean().optional().nullable(),
}).passthrough();

const candidatePayloadSchema = z.object({
  kind: z.literal("candidate"),
  address: z.string().min(3),
  candidate: z.record(z.string(), z.unknown()),
});

const listingPayloadSchema = z.object({
  kind: z.literal("listing"),
  address: z.string().min(3),
  listing: z.record(z.string(), z.unknown()),
});

const reportPayloadSchema = z.object({
  kind: z.literal("report"),
  address: z.string().min(3),
  photoUrl: z.string().optional().nullable(),
  photoUrls: z.array(z.string()).optional().nullable(),
  listingUrl: z.string().optional().nullable(),
  selectedListingContext: selectedListingContextSchema.optional().nullable(),
  summary: z.object({
    score: z.number().optional().nullable(),
    zone: z.string().optional().nullable(),
    bedrooms: z.number().optional().nullable(),
    bathrooms: z.number().optional().nullable(),
    titleStatus: z.string().optional().nullable(),
    titleType: z.string().optional().nullable(),
    potentialLots: z.number().optional().nullable(),
    designLedRange: z.object({ min: z.number(), max: z.number() }).optional().nullable(),
    landArea: z.string().optional().nullable(),
    floorArea: z.string().optional().nullable(),
    listingPrice: z.string().optional().nullable(),
  }).optional().nullable(),
});

const createShareSchema = z.discriminatedUnion("kind", [candidatePayloadSchema, listingPayloadSchema, reportPayloadSchema]);

type ShareKind = "candidate" | "listing" | "report";

function explicitShareBaseUrl(): string | null {
  const url = (process.env.PUBLIC_SHARE_URL ?? process.env.SHARE_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(url) ? url : null;
}

function requestOrigin(req: Request | null | undefined): string | null {
  if (!req) return null;
  const forwardedHost = cleanText(req.headers["x-forwarded-host"], "");
  const host = forwardedHost || cleanText(req.headers.host, "");
  if (!host) return null;
  const forwardedProto = cleanText(req.headers["x-forwarded-proto"], "");
  const proto = forwardedProto.split(",")[0]?.trim() || req.protocol || "https";
  const origin = `${proto}://${host}`.replace(/\/+$/, "");
  return /^https?:\/\//i.test(origin) ? origin : null;
}

function baseUrl(req?: Request | null): string {
  const explicit = explicitShareBaseUrl();
  if (explicit) return explicit;

  const requestUrl = requestOrigin(req);
  if (requestUrl) return requestUrl;

  const url = getPublicAppUrl().replace(/\/+$/, "");
  return /^https?:\/\//i.test(url) ? url : "https://projectalpha.app";
}

function shareUrl(token: string, req?: Request | null): string {
  return `${baseUrl(req)}/share/${encodeURIComponent(token)}`;
}

function randomToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

function cleanText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").trim() || fallback;
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function candidateDescription(candidate: Record<string, unknown>): string {
  const bits: string[] = [];
  const score = (candidate.scores as Record<string, unknown> | undefined)?.composite;
  if (typeof score === "number" && score > 0) bits.push(`Score ${score.toFixed(1)}/5`);
  const zone = cleanText(candidate.zone, "");
  if (zone) bits.push(zone);
  const lots = typeof candidate.potentialLots === "number" ? candidate.potentialLots : null;
  if (lots && lots > 1) bits.push(`${lots} potential lots`);
  const designRange = candidate.designLedYieldRange as Record<string, unknown> | undefined;
  if (typeof designRange?.min === "number" && typeof designRange?.max === "number") {
    bits.push(`design-led ${designRange.min}-${designRange.max} lots to test`);
  }
  const price = typeof candidate.price === "number" && candidate.price > 0
    ? `$${(candidate.price / 1_000_000).toFixed(2)}M`
    : null;
  if (price) bits.push(price);
  return bits.length
    ? `${bits.join(" | ")}. Open Project Alpha to view more.`
    : "Open Project Alpha to view this property opportunity.";
}

function listingDescription(listing: Record<string, unknown>): string {
  const rawDescription = cleanText(listing.description, "");
  if (rawDescription) return rawDescription.slice(0, 220);
  const bits: string[] = [];
  const priceDisplay = cleanText(listing.priceDisplay, "");
  if (priceDisplay) bits.push(priceDisplay);
  const propertyType = cleanText(listing.propertyType, "");
  if (propertyType) bits.push(propertyType);
  const landArea = typeof listing.landAreaSqm === "number" && listing.landAreaSqm > 0
    ? `${listing.landAreaSqm.toLocaleString("en-NZ")} sqm land`
    : null;
  if (landArea) bits.push(landArea);
  return bits.length
    ? `${bits.join(" | ")}. Open Project Alpha to view this listing.`
    : "Open Project Alpha to view this property listing.";
}

function reportDescription(summary: z.infer<typeof reportPayloadSchema>["summary"]): string {
  const bits: string[] = [];
  if (typeof summary?.score === "number" && summary.score > 0) bits.push(`Score ${summary.score.toFixed(1)}/5`);
  if (summary?.zone) bits.push(cleanText(summary.zone));
  if (typeof summary?.potentialLots === "number" && summary.potentialLots > 1) {
    bits.push(`${summary.potentialLots} potential lots`);
  }
  if (summary?.designLedRange) bits.push(`design-led ${summary.designLedRange.min}-${summary.designLedRange.max} lots to test`);
  if (summary?.landArea) bits.push(cleanText(summary.landArea));
  return bits.length
    ? `${bits.join(" | ")}. Open Project Alpha for the latest analysis.`
    : "Open Project Alpha to view the latest feasibility analysis.";
}

function buildShare(input: z.infer<typeof createShareSchema>) {
  if (input.kind === "candidate") {
    const candidate = input.candidate;
    const photoUrls = Array.isArray(candidate.photoUrls) ? candidate.photoUrls : [];
    const title = `${input.address} - Project Alpha property opportunity`;
    return {
      kind: input.kind,
      address: input.address,
      previewTitle: title,
      previewDescription: candidateDescription(candidate),
      previewImageUrl: cleanUrl(candidate.photoUrl) ?? cleanUrl(photoUrls[0]),
      payloadJson: {
        kind: "candidate",
        address: input.address,
        candidate,
      },
    };
  }

  if (input.kind === "listing") {
    const listing = input.listing;
    const imageUrls = Array.isArray(listing.imageUrls) ? listing.imageUrls : [];
    const title = `${input.address} - Project Alpha property listing`;
    return {
      kind: input.kind,
      address: input.address,
      previewTitle: title,
      previewDescription: listingDescription(listing),
      previewImageUrl: cleanUrl(imageUrls[0]) ?? cleanUrl(listing.photoUrl),
      payloadJson: {
        kind: "listing",
        address: input.address,
        listing,
      },
    };
  }

  const title = `${input.address} - Project Alpha feasibility analysis`;
  const image = cleanUrl(input.photoUrl) ?? cleanUrl(input.photoUrls?.[0]);
  const selectedListingContext = input.selectedListingContext ?? null;
  const selectedListingUrl = cleanUrl(input.listingUrl) ?? cleanUrl(selectedListingContext?.listingUrl);
  const selectedPhotoUrl = image ?? cleanUrl(selectedListingContext?.photoUrl);
  return {
    kind: input.kind,
    address: input.address,
    previewTitle: title,
    previewDescription: reportDescription(input.summary ?? null),
    previewImageUrl: image,
    payloadJson: {
      kind: "report",
      address: input.address,
      rerun: {
        address: input.address,
        selectedListingUrl,
        selectedPhotoUrl,
        selectedListingContext,
      },
      preview: {
        summary: input.summary ?? null,
      },
    },
  };
}

function notExpiredCondition() {
  return or(isNull(propertyShares.expiresAt), gt(propertyShares.expiresAt, new Date()));
}

async function optionalUserId(req: Request, res: Response): Promise<string | null | undefined> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const payload = await verifyActiveToken(authHeader.slice(7)).catch(() => null);
  if (!payload) {
    res.status(401).json({ error: "This account is now signed in on another device.", code: "SESSION_REPLACED" });
    return undefined;
  }
  return payload.sub;
}

async function getPublicShare(token: string) {
  const [row] = await db
    .select({
      token: propertyShares.token,
      kind: propertyShares.kind,
      address: propertyShares.address,
      previewTitle: propertyShares.previewTitle,
      previewDescription: propertyShares.previewDescription,
      previewImageUrl: propertyShares.previewImageUrl,
      payloadJson: propertyShares.payloadJson,
      createdAt: propertyShares.createdAt,
    })
    .from(propertyShares)
    .where(and(eq(propertyShares.token, token), notExpiredCondition()))
    .limit(1);
  return row ?? null;
}

type PublicShareRow = NonNullable<Awaited<ReturnType<typeof getPublicShare>>>;

function publicPreview(row: PublicShareRow | null, req?: Request | null) {
  if (!row) return null;
  return {
    token: row.token,
    kind: row.kind as ShareKind,
    address: row.address,
    title: row.previewTitle,
    description: row.previewDescription,
    imageUrl: row.previewImageUrl,
    url: shareUrl(row.token, req),
    facts: propertyFacts(row.payloadJson),
  };
}

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

type Fact = { label: string; value: string };

function recordValue(source: unknown, key: string): unknown {
  if (!source || typeof source !== "object") return undefined;
  return (source as Record<string, unknown>)[key];
}

function firstValue(source: unknown, keys: string[]): unknown {
  for (const key of keys) {
    const value = recordValue(source, key);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function numberFact(value: unknown, suffix = ""): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return `${value.toLocaleString("en-NZ")}${suffix}`;
}

function textFact(value: unknown): string | null {
  const cleaned = cleanText(value, "");
  return cleaned || null;
}

function propertyFacts(payload: unknown): Fact[] {
  const kind = textFact(recordValue(payload, "kind"));
  const source =
    kind === "candidate"
      ? recordValue(payload, "candidate")
      : kind === "listing"
        ? recordValue(payload, "listing")
        : recordValue(recordValue(payload, "preview"), "summary");
  const facts: Fact[] = [];
  const push = (label: string, value: string | null) => {
    if (value && !facts.some((fact) => fact.label === label)) facts.push({ label, value });
  };

  push("Bedrooms", numberFact(firstValue(source, ["bedrooms", "bedroomCount"])));
  push("Bathrooms", numberFact(firstValue(source, ["bathrooms", "bathroomCount"])));
  push("Zoning", textFact(firstValue(source, ["zone", "zoning"])));
  push("Title status", textFact(firstValue(source, ["titleStatus", "titleType", "tenure"])));
  push("Land area", numberFact(firstValue(source, ["landArea", "landAreaSqm"]), "m²") ?? textFact(firstValue(source, ["landAreaDisplay", "landArea"])));
  push("Floor area", numberFact(firstValue(source, ["floorArea", "floorAreaSqm"]), "m²") ?? textFact(firstValue(source, ["floorAreaDisplay", "floorArea"])));

  return facts;
}

function sharePreviewHtml(preview: ReturnType<typeof publicPreview>, req?: Request | null): string {
  const found = !!preview;
  const title = preview?.title ?? "Project Alpha property share";
  const description = preview?.description ?? "This Project Alpha share link could not be found or has expired.";
  const url = preview?.url ?? `${baseUrl(req)}/`;
  const image = preview?.imageUrl ?? `${baseUrl(req)}/favicon.png`;
  const safeTitle = htmlEscape(title);
  const safeDescription = htmlEscape(description);
  const safeImage = htmlEscape(image);
  const safeUrl = htmlEscape(url);
  const safeIosStoreUrl = htmlEscape(getIosAppStoreUrl());
  const safeAndroidStoreUrl = htmlEscape(getAndroidPlayStoreUrl());
  const safeSalesPortalUrl = htmlEscape("https://www.projectalpha.app/sales-portal/");
  const safeAppOpenUrl = preview
    ? htmlEscape(`devfeasible://share/${encodeURIComponent(preview.token)}`)
    : safeUrl;
  const safeAddress = htmlEscape(preview?.address ?? "Shared property");
  const facts = preview?.facts ?? [];
  const factsHtml = facts.length
    ? `<dl class="facts">${facts.map((fact) => `<div><dt>${htmlEscape(fact.label)}</dt><dd>${htmlEscape(fact.value)}</dd></div>`).join("")}</dl>`
    : "";
  const cta = found ? "Open Project Alpha to view more" : "Get Project Alpha";

  return `<!doctype html>
<html lang="en-NZ">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:image" content="${safeImage}" />
    <meta property="og:url" content="${safeUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${safeImage}" />
    <link rel="canonical" href="${safeUrl}" />
    <link rel="icon" href="/favicon.png" />
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: #f6f1e8; color: #1d1a17; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
      .card { width: min(100%, 560px); overflow: hidden; border: 1px solid rgba(29,26,23,.12); border-radius: 22px; background: #fffaf3; box-shadow: 0 20px 60px rgba(29,26,23,.12); }
      .hero { aspect-ratio: 16 / 9; background: #1d1a17; display: grid; place-items: center; overflow: hidden; }
      .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .hero-fallback { color: #fffaf3; font-size: 52px; font-weight: 800; letter-spacing: -.04em; }
      .body { padding: 24px; display: grid; gap: 16px; }
      .eyebrow { margin: 0; color: #d97757; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
      h1 { margin: 0; font-size: clamp(25px, 6vw, 38px); line-height: 1.05; letter-spacing: -.02em; }
      p { margin: 0; color: #6f675c; line-height: 1.55; }
      .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; }
      .facts div { padding: 12px; border: 1px solid rgba(29,26,23,.10); border-radius: 10px; background: rgba(29,26,23,.035); }
      .facts dt { margin: 0 0 4px; color: #8a8176; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
      .facts dd { margin: 0; color: #1d1a17; font-size: 15px; font-weight: 800; line-height: 1.25; }
      .actions { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 4px; }
      .button { display: flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 16px; border: 0; border-radius: 12px; text-decoration: none; font: inherit; font-weight: 800; cursor: pointer; box-sizing: border-box; }
      .primary { background: #d97757; color: white; }
      .secondary { background: #1d1a17; color: white; }
      .divider { height: 1px; background: rgba(29,26,23,.12); margin: 4px 0; }
      @media (max-width: 520px) { .body { padding: 20px; } .facts { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <article class="card">
        <div class="hero">
          ${preview?.imageUrl ? `<img src="${safeImage}" alt="" />` : `<div class="hero-fallback">PA</div>`}
        </div>
        <div class="body">
          <p class="eyebrow">Project Alpha</p>
          <h1>${safeAddress}</h1>
          <p>${safeDescription}</p>
          ${factsHtml}
          <div class="actions">
            <a
              class="button primary"
              id="open-app-button"
              href="${safeUrl}"
              data-app-url="${safeAppOpenUrl}"
              data-ios-store="${safeIosStoreUrl}"
              data-android-store="${safeAndroidStoreUrl}"
            >${htmlEscape(cta)}</a>
            <div class="divider" aria-hidden="true"></div>
            <a class="button secondary" href="${safeSalesPortalUrl}">Property listing (Property Agent)</a>
          </div>
        </div>
      </article>
    </main>
    <script>
      (function () {
        var button = document.getElementById("open-app-button");
        if (!button) return;
        button.addEventListener("click", function (event) {
          var ua = navigator.userAgent || "";
          var isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
          var isAndroid = /Android/i.test(ua);
          if (!isiOS && !isAndroid) return;

          event.preventDefault();
          var fallback = isiOS ? button.dataset.iosStore : button.dataset.androidStore;
          var appUrl = button.dataset.appUrl || button.href;
          var cancelled = false;
          var cancel = function () { cancelled = true; };
          document.addEventListener("visibilitychange", function () {
            if (document.hidden) cancel();
          }, { once: true });
          window.addEventListener("pagehide", cancel, { once: true });
          window.addEventListener("blur", cancel, { once: true });
          window.setTimeout(function () {
            if (!cancelled && fallback) window.location.assign(fallback);
          }, 1400);
          window.location.assign(appUrl);
        });
      })();
    </script>
  </body>
</html>`;
}

router.post("/shares", async (req, res) => {
  const userId = await optionalUserId(req, res);
  if (userId === undefined) return;

  const parsed = createShareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid share payload", code: "INVALID_SHARE_PAYLOAD" });
    return;
  }

  const share = buildShare(parsed.data);

  try {
    const [existing] = userId
      ? await db
          .select()
          .from(propertyShares)
          .where(and(
            eq(propertyShares.ownerUserId, userId),
            eq(propertyShares.kind, share.kind),
            eq(propertyShares.address, share.address),
            notExpiredCondition(),
          ))
          .orderBy(desc(propertyShares.createdAt))
          .limit(1)
      : [];

    const token = existing?.token ?? randomToken();
    const [row] = existing
      ? await db
          .update(propertyShares)
          .set({
            previewTitle: share.previewTitle,
            previewDescription: share.previewDescription,
            previewImageUrl: share.previewImageUrl,
            payloadJson: share.payloadJson,
          })
          .where(eq(propertyShares.id, existing.id))
          .returning()
      : await db
          .insert(propertyShares)
          .values({
            token,
            ownerUserId: userId,
            kind: share.kind,
            address: share.address,
            previewTitle: share.previewTitle,
            previewDescription: share.previewDescription,
            previewImageUrl: share.previewImageUrl,
            payloadJson: share.payloadJson,
          })
          .returning();

    res.json({ token: row.token, url: shareUrl(row.token, req), preview: publicPreview(row, req) });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create property share");
    res.status(500).json({ error: "Could not create share link", code: "SHARE_CREATE_FAILED" });
  }
});

router.get("/shares/:token", async (req, res) => {
  if ((await optionalUserId(req, res)) === undefined) return;

  const token = cleanText(req.params.token);
  if (!token) {
    res.status(400).json({ error: "token is required", code: "MISSING_TOKEN" });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(propertyShares)
      .where(and(eq(propertyShares.token, token), notExpiredCondition()))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Share not found", code: "SHARE_NOT_FOUND" });
      return;
    }
    res.json({
      token: row.token,
      kind: row.kind,
      address: row.address,
      preview: publicPreview(row, req),
      payload: row.payloadJson,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to open property share");
    res.status(500).json({ error: "Could not open share", code: "SHARE_OPEN_FAILED" });
  }
});

router.get("/share/:token/preview", async (req, res) => {
  const token = cleanText(req.params.token);
  const row = token ? await getPublicShare(token).catch(() => null) : null;
  const preview = publicPreview(row, req);
  if (!preview) {
    res.status(404).json({ error: "Share not found", code: "SHARE_NOT_FOUND" });
    return;
  }
  res.json({ preview });
});

async function sendSharePage(req: Request, res: Response) {
  const token = cleanText(req.params.token);
  const row = token ? await getPublicShare(token).catch(() => null) : null;
  const preview = publicPreview(row, req);
  res.status(preview ? 200 : 404).type("html").send(sharePreviewHtml(preview, req));
}

router.get("/share/:token", sendSharePage);

router.get("/share/:token/page", sendSharePage);

export default router;
