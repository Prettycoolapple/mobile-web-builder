import { Router, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, profiles, providerBrandKits, withDbRetry } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { resolveProviderEntitlement } from "../lib/provider-entitlements";
import { generateExecutiveSummary } from "../lib/claude";
import { sendReportPdfEmail } from "../lib/mailer";

const router = Router();

/** Cap a data-URL / text field so a brand kit row stays sane. */
const MAX_LOGO_CHARS = 2_000_000; // ~1.5 MB binary as base64
const MAX_PDF_CHARS = 9_000_000; // ~6.7 MB binary; stays under the 8mb json body limit
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Gate PDF/brand-kit routes to service providers with active web access
 * (Stripe / trial / IAP). Mirrors the workspace's own entry gate so these
 * endpoints can't be used by non-providers or lapsed accounts.
 */
const requireProviderAccess: RequestHandler = async (req, res, next) => {
  const userId = (req as any).userId as string;
  try {
    const [profile] = await withDbRetry(() =>
      db.select().from(profiles).where(eq(profiles.id, userId)).limit(1),
    );
    if (!profile || profile.role !== "service_provider") {
      res.status(403).json({ error: "Provider account required.", code: "PROVIDER_ONLY" });
      return;
    }
    const entitlement = resolveProviderEntitlement(profile);
    if (!entitlement.providerAccessActive) {
      res.status(402).json({
        error: "An active subscription is required to export branded reports.",
        code: "subscription_required",
      });
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, "Provider access check failed");
    res.status(500).json({ error: "Could not verify account.", code: "PROVIDER_CHECK_FAILED" });
  }
};

function publicBrandKit(row: typeof providerBrandKits.$inferSelect) {
  return {
    logoUrl: row.logoUrl,
    brandColor: row.brandColor,
    companyName: row.companyName,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    website: row.website,
    licenceNumber: row.licenceNumber,
    footerText: row.footerText,
    extraImageUrls: row.extraImageUrls ?? [],
  };
}

/** GET /provider/brand-kit — the saved white-label kit (or null defaults). */
router.get("/provider/brand-kit", requireAuth, requireProviderAccess, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const [row] = await withDbRetry(() =>
      db.select().from(providerBrandKits).where(eq(providerBrandKits.userId, userId)).limit(1),
    );
    res.json({ brandKit: row ? publicBrandKit(row) : null });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load brand kit");
    res.status(500).json({ error: "Failed to load brand kit", code: "BRAND_KIT_LOAD_FAILED" });
  }
});

/** PUT /provider/brand-kit — upsert the white-label kit (one row per user). */
router.put("/provider/brand-kit", requireAuth, requireProviderAccess, async (req, res) => {
  const userId = (req as any).userId as string;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const logoUrl = str(body.logoUrl, MAX_LOGO_CHARS);
  const extraImageUrls = Array.isArray(body.extraImageUrls)
    ? body.extraImageUrls.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, MAX_LOGO_CHARS)).slice(0, 4)
    : [];
  const contactEmail = str(body.contactEmail);
  if (contactEmail && !EMAIL_RE.test(contactEmail)) {
    res.status(400).json({ error: "Invalid contact email", code: "INVALID_EMAIL" });
    return;
  }

  const values = {
    userId,
    logoUrl,
    brandColor: str(body.brandColor, 32),
    companyName: str(body.companyName, 200),
    contactName: str(body.contactName, 200),
    contactEmail,
    contactPhone: str(body.contactPhone, 64),
    website: str(body.website, 300),
    licenceNumber: str(body.licenceNumber, 100),
    footerText: str(body.footerText, 600),
    extraImageUrls,
    updatedAt: new Date(),
  };

  try {
    const [row] = await withDbRetry(() =>
      db
        .insert(providerBrandKits)
        .values(values)
        .onConflictDoUpdate({ target: providerBrandKits.userId, set: { ...values } })
        .returning(),
    );
    res.json({ brandKit: row ? publicBrandKit(row) : null });
  } catch (error) {
    req.log.error({ err: error }, "Failed to save brand kit");
    res.status(500).json({ error: "Failed to save brand kit", code: "BRAND_KIT_SAVE_FAILED" });
  }
});

/** POST /reports/pdf/summary — DeepSeek executive summary for the PDF cover. */
router.post("/reports/pdf/summary", requireAuth, requireProviderAccess, async (req, res) => {
  const report = (req.body ?? {}).report as Record<string, unknown> | undefined;
  if (!report || typeof report !== "object") {
    res.status(400).json({ error: "report is required", code: "MISSING_REPORT" });
    return;
  }
  try {
    const summary = await generateExecutiveSummary(report);
    res.json({ summary });
  } catch (error) {
    req.log.error({ err: error }, "Executive summary generation failed");
    res.status(502).json({ error: "Couldn't generate a summary. Please try again.", code: "SUMMARY_FAILED" });
  }
});

/**
 * POST /reports/pdf/email — the workspace renders the white-label PDF client-side
 * and posts the bytes (base64); we attach + send via Resend, with the provider's
 * own email as reply-to so the client can respond directly.
 */
router.post("/reports/pdf/email", requireAuth, requireProviderAccess, async (req, res) => {
  const userId = (req as any).userId as string;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const toEmail = str(body.toEmail);
  const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : "";
  const message = str(body.message, 4000) ?? "";
  const subject = str(body.subject, 200) ?? "Your feasibility report";
  const filename = (str(body.filename, 120) ?? "feasibility-report.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");

  if (!toEmail || !EMAIL_RE.test(toEmail)) {
    res.status(400).json({ error: "A valid recipient email is required.", code: "INVALID_RECIPIENT" });
    return;
  }
  if (!pdfBase64 || pdfBase64.length > MAX_PDF_CHARS) {
    res.status(400).json({
      error: pdfBase64 ? "The PDF is too large to email. Download it and attach manually." : "Missing PDF data.",
      code: pdfBase64 ? "PDF_TOO_LARGE" : "MISSING_PDF",
    });
    return;
  }

  try {
    const [profile] = await withDbRetry(() =>
      db.select().from(profiles).where(eq(profiles.id, userId)).limit(1),
    );
    const [kit] = await withDbRetry(() =>
      db.select().from(providerBrandKits).where(eq(providerBrandKits.userId, userId)).limit(1),
    );
    const replyTo = kit?.contactEmail || profile?.email || null;
    const fromName = kit?.companyName || profile?.fullName || null;

    const result = await sendReportPdfEmail({
      to: toEmail,
      replyTo,
      fromName,
      subject,
      message,
      filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
      pdfBase64,
    });
    if (!result.ok) {
      res.status(502).json({ error: result.error, code: "EMAIL_SEND_FAILED" });
      return;
    }
    res.json({ sent: true });
  } catch (error) {
    req.log.error({ err: error }, "Report PDF email failed");
    res.status(500).json({ error: "Failed to send the email.", code: "EMAIL_FAILED" });
  }
});

export default router;
