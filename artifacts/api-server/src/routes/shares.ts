import { Router, type Request, type Response } from "express";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import crypto from "node:crypto";
import { z } from "zod";
import { db, propertyShares } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { getPublicAppUrl } from "../lib/env";

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
    potentialLots: z.number().optional().nullable(),
    designLedRange: z.object({ min: z.number(), max: z.number() }).optional().nullable(),
    landArea: z.string().optional().nullable(),
    listingPrice: z.string().optional().nullable(),
  }).optional().nullable(),
});

const createShareSchema = z.discriminatedUnion("kind", [candidatePayloadSchema, reportPayloadSchema]);

type ShareKind = "candidate" | "report";

function baseUrl(): string {
  const url = getPublicAppUrl().replace(/\/+$/, "");
  return /^https?:\/\//i.test(url) ? url : "https://projectalpha.app";
}

function shareUrl(token: string): string {
  return `${baseUrl()}/share/${encodeURIComponent(token)}`;
}

function appSchemeUrl(token: string): string {
  return `devfeasible://share/${encodeURIComponent(token)}`;
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
    const title = `${input.address} - Project Alpha property opportunity`;
    return {
      kind: input.kind,
      address: input.address,
      previewTitle: title,
      previewDescription: candidateDescription(candidate),
      previewImageUrl: cleanUrl(candidate.photoUrl),
      payloadJson: {
        kind: "candidate",
        address: input.address,
        candidate,
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

async function getPublicShare(token: string) {
  const [row] = await db
    .select({
      token: propertyShares.token,
      kind: propertyShares.kind,
      address: propertyShares.address,
      previewTitle: propertyShares.previewTitle,
      previewDescription: propertyShares.previewDescription,
      previewImageUrl: propertyShares.previewImageUrl,
      createdAt: propertyShares.createdAt,
    })
    .from(propertyShares)
    .where(and(eq(propertyShares.token, token), notExpiredCondition()))
    .limit(1);
  return row ?? null;
}

type PublicShareRow = NonNullable<Awaited<ReturnType<typeof getPublicShare>>>;

function publicPreview(row: PublicShareRow | null) {
  if (!row) return null;
  return {
    token: row.token,
    kind: row.kind as ShareKind,
    address: row.address,
    title: row.previewTitle,
    description: row.previewDescription,
    imageUrl: row.previewImageUrl,
    url: shareUrl(row.token),
    appUrl: appSchemeUrl(row.token),
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

function sharePreviewHtml(preview: ReturnType<typeof publicPreview>): string {
  const found = !!preview;
  const title = preview?.title ?? "Project Alpha property share";
  const description = preview?.description ?? "This Project Alpha share link could not be found or has expired.";
  const url = preview?.url ?? `${baseUrl()}/`;
  const image = preview?.imageUrl ?? `${baseUrl()}/favicon.png`;
  const appUrl = preview?.appUrl ?? "devfeasible://";
  const safeTitle = htmlEscape(title);
  const safeDescription = htmlEscape(description);
  const safeImage = htmlEscape(image);
  const safeUrl = htmlEscape(url);
  const safeAppUrl = htmlEscape(appUrl);
  const safeAddress = htmlEscape(preview?.address ?? "Shared property");
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
      .actions { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 4px; }
      .button { display: flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 16px; border-radius: 12px; text-decoration: none; font-weight: 800; }
      .primary { background: #d97757; color: white; }
      .secondary { background: #1d1a17; color: white; }
      .store { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .store .button { background: rgba(29,26,23,.08); color: #1d1a17; }
      @media (max-width: 520px) { .store { grid-template-columns: 1fr; } .body { padding: 20px; } }
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
          <div class="actions">
            <a class="button primary" href="${safeAppUrl}">${htmlEscape(cta)}</a>
            <div class="store">
              <a class="button" href="https://apps.apple.com/nz/app/project-alpha/id6762080292" rel="noopener">iOS App Store</a>
              <a class="button" href="https://play.google.com/store/apps/details?id=nz.devfeasible.app" rel="noopener">Android Play Store</a>
            </div>
            <a class="button secondary" href="/">Project Alpha website</a>
          </div>
        </div>
      </article>
    </main>
  </body>
</html>`;
}

router.post("/shares", requireAuth, async (req, res) => {
  const parsed = createShareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid share payload", code: "INVALID_SHARE_PAYLOAD" });
    return;
  }

  const userId = (req as any).userId as string;
  const share = buildShare(parsed.data);

  try {
    const [existing] = await db
      .select()
      .from(propertyShares)
      .where(and(
        eq(propertyShares.ownerUserId, userId),
        eq(propertyShares.kind, share.kind),
        eq(propertyShares.address, share.address),
        notExpiredCondition(),
      ))
      .orderBy(desc(propertyShares.createdAt))
      .limit(1);

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

    res.json({ token: row.token, url: shareUrl(row.token), preview: publicPreview(row) });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create property share");
    res.status(500).json({ error: "Could not create share link", code: "SHARE_CREATE_FAILED" });
  }
});

router.get("/shares/:token", requireAuth, async (req, res) => {
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
      preview: publicPreview(row),
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
  const preview = publicPreview(row);
  if (!preview) {
    res.status(404).json({ error: "Share not found", code: "SHARE_NOT_FOUND" });
    return;
  }
  res.json({ preview });
});

async function sendSharePage(req: Request, res: Response) {
  const token = cleanText(req.params.token);
  const row = token ? await getPublicShare(token).catch(() => null) : null;
  const preview = publicPreview(row);
  res.status(preview ? 200 : 404).type("html").send(sharePreviewHtml(preview));
}

router.get("/share/:token", sendSharePage);

router.get("/share/:token/page", sendSharePage);

export default router;
