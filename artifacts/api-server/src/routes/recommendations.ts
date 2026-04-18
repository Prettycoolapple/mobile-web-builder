import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  db,
  profiles,
  serviceProviderProfiles,
  dmThreads,
  dmMessages,
  pushTokens,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ai } from "@workspace/integrations-gemini-ai";
import { sendExpoPush } from "../lib/expo-push";

const router: IRouter = Router();

export interface ServiceProvider {
  id: string;
  fullName: string | null;
  companyName: string | null;
  discipline: string | null;
  bio: string | null;
  recommendationCount: number;
  avatarUrl: string | null;
  isVerified: boolean;
  contactNumber: string | null;
  addressSuburb: string | null;
  addressCity: string | null;
  primaryLanguage: string | null;
}

interface FeasibilityReport {
  address?: string;
  scores?: { ease?: number; cost?: number; roi?: number };
  lots?: { lots?: number };
  merged?: { zone_code?: string; land_area_sqm?: number };
  scenarios?: Array<{ viable?: boolean }>;
  planning?: { zone_code?: string };
  potential_lots?: number;
}

interface Message {
  role: string;
  content: string;
}

async function detectDevelopmentIntent(
  report: FeasibilityReport,
  conversationHistory: Message[],
): Promise<{
  shouldRecommend: boolean;
  intentType: "subdivision" | "newbuild" | "renovation" | "none";
  confidence: number;
  reason: string;
}> {
  const zoneCode = report.merged?.zone_code ?? report.planning?.zone_code ?? "";
  const lots = report.lots?.lots ?? report.potential_lots ?? 0;
  const landArea = report.merged?.land_area_sqm ?? 0;
  const ease = report.scores?.ease ?? 0;
  const hasViableScenario = report.scenarios?.some((s) => s.viable) ?? false;

  const signals = {
    isSubdividable: lots >= 2,
    isDevelopmentZone: ["THAB", "MHU", "MHS", "MIX"].includes(zoneCode),
    isLargeLand: landArea > 500,
    hasGoodEase: ease >= 2.5,
    hasPositiveROI: hasViableScenario,
  };

  const signalCount = Object.values(signals).filter(Boolean).length;

  const recentMessages = conversationHistory
    .slice(-6)
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();

  const developerKeywords = [
    "build", "develop", "subdivide", "architect",
    "builder", "engineer", "construction", "consent",
    "townhouse", "units", "new build",
  ];

  const hasKeywordIntent = developerKeywords.some((kw) =>
    recentMessages.includes(kw),
  );

  if (signalCount >= 3 || (hasKeywordIntent && signalCount >= 2)) {
    try {
      const prompt = `A user just analysed a NZ property with these details:
Zone: ${zoneCode}
Potential lots: ${lots}
Land area: ${landArea}m²
Ease score: ${ease}/5
ROI viable: ${hasViableScenario}

Recent conversation: "${recentMessages.slice(-200)}"

Should we recommend a development service provider (builder, architect, or project manager)?

Reply with ONLY valid JSON (no markdown):
{"recommend": true, "type": "subdivision", "reason": "one sentence"}

type must be one of: subdivision, newbuild, renovation, none`;

      const geminiResult = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens: 150, temperature: 0 },
      });

      const raw = geminiResult.text?.trim() ?? "";
      const cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);

      return {
        shouldRecommend: Boolean(parsed.recommend),
        intentType: parsed.type ?? (signals.isSubdividable ? "subdivision" : "newbuild"),
        confidence: signalCount / 5,
        reason: parsed.reason ?? "Property shows development potential",
      };
    } catch {
      return {
        shouldRecommend: true,
        intentType: signals.isSubdividable ? "subdivision" : "newbuild",
        confidence: signalCount / 5,
        reason: "Property shows strong development potential",
      };
    }
  }

  return { shouldRecommend: false, intentType: "none", confidence: 0, reason: "" };
}

async function selectServiceProvider(preferredDiscipline?: string | null): Promise<ServiceProvider | null> {
  const baseQuery = db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
      isVerified: profiles.isVerified,
      companyName: serviceProviderProfiles.companyName,
      discipline: serviceProviderProfiles.discipline,
      bio: serviceProviderProfiles.bio,
      recommendationCount: serviceProviderProfiles.recommendationCount,
      contactNumber: serviceProviderProfiles.contactNumber,
      addressSuburb: serviceProviderProfiles.addressSuburb,
      addressCity: serviceProviderProfiles.addressCity,
      primaryLanguage: serviceProviderProfiles.primaryLanguage,
    })
    .from(profiles)
    .innerJoin(serviceProviderProfiles, eq(serviceProviderProfiles.userId, profiles.id))
    .where(eq(profiles.role, "service_provider"))
    .orderBy(desc(serviceProviderProfiles.recommendationCount))
    .limit(6);

  const rows = await baseQuery;
  if (rows.length === 0) return null;

  // Prefer matching discipline if specified, otherwise pick from all
  let candidates = rows;
  if (preferredDiscipline) {
    const matched = rows.filter((r) => r.discipline === preferredDiscipline);
    if (matched.length > 0) candidates = matched;
  }

  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  return {
    id: selected.id,
    fullName: selected.fullName,
    avatarUrl: selected.avatarUrl ?? null,
    isVerified: selected.isVerified,
    companyName: selected.companyName ?? null,
    discipline: selected.discipline ?? null,
    bio: selected.bio ?? null,
    recommendationCount: selected.recommendationCount,
    contactNumber: selected.contactNumber ?? null,
    addressSuburb: selected.addressSuburb ?? null,
    addressCity: selected.addressCity ?? null,
    primaryLanguage: selected.primaryLanguage ?? null,
  };
}

router.post("/recommendations/check", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const [currentUser] = await db
      .select({ role: profiles.role, subscriptionTier: profiles.subscriptionTier })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!currentUser || currentUser.role !== "general") {
      res.json({ shouldRecommend: false, provider: null });
      return;
    }

    // Provider recommendations & in-app DM are a Standard-tier feature for
    // general users. Free users still see the chat suggestion but can't
    // initiate a connection.
    const tier = currentUser.subscriptionTier ?? "free";
    if (tier !== "standard" && tier !== "pro") {
      res.json({
        shouldRecommend: false,
        provider: null,
        intentType: "none",
        upgradeRequired: true,
      });
      return;
    }

    const {
      report,
      conversationHistory,
      followUpCount = 0,
      explicitRequest = false,
      preferredDiscipline,
    } = req.body as {
      report?: FeasibilityReport;
      conversationHistory?: Message[];
      followUpCount?: number;
      explicitRequest?: boolean;
      preferredDiscipline?: string;
    };

    // Explicit referral request (user said "recommend someone", "any providers", etc.)
    // — skip all gates and go straight to the database. No report required.
    if (explicitRequest) {
      req.log.info({ preferredDiscipline }, "Explicit recommendation request — bypassing probability and intent gates");
      const provider = await selectServiceProvider(preferredDiscipline ?? null);
      res.json({
        shouldRecommend: provider !== null,
        provider,
        intentType: "referral",
        reason: "User explicitly asked for a service provider recommendation",
      });
      return;
    }

    if (!report) {
      res.status(400).json({ error: "report is required for non-explicit checks" });
      return;
    }

    // Probability gate: 30% base + 10% per follow-up, capped at 70%
    const probability = Math.min(0.70, 0.30 + followUpCount * 0.10);
    if (Math.random() > probability) {
      req.log.info({ followUpCount, probability }, "Recommendation skipped by probability gate");
      res.json({ shouldRecommend: false, provider: null, intentType: "none" });
      return;
    }

    const intent = await detectDevelopmentIntent(report, conversationHistory ?? []);

    if (!intent.shouldRecommend) {
      res.json({ shouldRecommend: false, provider: null, intentType: intent.intentType });
      return;
    }

    // Always prefer providers from the database; online search is a last-resort fallback (rarely used)
    const provider = await selectServiceProvider();
    res.json({ shouldRecommend: true, provider, intentType: intent.intentType, reason: intent.reason });
  } catch (err) {
    req.log.error({ err }, "POST /recommendations/check failed");
    res.status(500).json({ error: "Recommendation check failed" });
  }
});

function formatReportSummary(report: Record<string, unknown> | undefined): string | null {
  if (!report) return null;

  const address = (report.address as string) ?? null;
  const overview = (report.propertyOverview as Record<string, unknown>) ?? {};
  const planning = (report.planning as Record<string, unknown>) ?? {};
  const scores = (report.scores as Record<string, unknown>) ?? {};

  const lines: string[] = [];
  if (address) lines.push(`📍 ${address}`);
  lines.push("");

  const details: string[] = [];
  if (overview.zone || report.zone_label) details.push(`Zone: ${(report.zone_label ?? overview.zone) as string}`);
  if (overview.landArea) details.push(`Land area: ${overview.landArea as string}`);
  if (overview.cv) details.push(`Capital value: ${overview.cv as string}`);
  if (planning.potentialLots ?? report.potential_lots) details.push(`Potential lots: ${(planning.potentialLots ?? report.potential_lots) as number}`);
  if (details.length > 0) lines.push(...details, "");

  if (scores.overall != null) lines.push(`Overall score: ${Number(scores.overall).toFixed(1)} / 5`);
  if (scores.planning != null) lines.push(`  Planning & zoning: ${Number(scores.planning).toFixed(1)}`);
  if (scores.cost != null) lines.push(`  Cost feasibility: ${Number(scores.cost).toFixed(1)}`);
  if (scores.roi != null) lines.push(`  ROI potential: ${Number(scores.roi).toFixed(1)}`);

  const briefSummary = report.brief_summary ?? report.briefSummary;
  if (briefSummary) lines.push("", String(briefSummary));

  return lines.join("\n").trim();
}

router.post("/recommendations/connect", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  const { providerId, propertyAddress, report } = req.body as {
    providerId?: string;
    propertyAddress?: string;
    report?: Record<string, unknown>;
  };

  if (!providerId || !propertyAddress) {
    res.status(400).json({ error: "providerId and propertyAddress are required" });
    return;
  }

  try {
    const [me] = await db
      .select({ role: profiles.role, subscriptionTier: profiles.subscriptionTier })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    // Only general users with a paid tier can initiate provider DMs.
    // Sales agents and providers can always reply via the DM routes themselves.
    if (me.role === "general") {
      const tier = me.subscriptionTier ?? "free";
      if (tier !== "standard" && tier !== "pro") {
        res.status(402).json({ error: "Upgrade required", upgradeRequired: true });
        return;
      }
    }

    const [canonA, canonB] = [userId, providerId].sort();

    const existing = await db
      .select()
      .from(dmThreads)
      .where(and(eq(dmThreads.participantA, canonA), eq(dmThreads.participantB, canonB)))
      .limit(1);

    let thread = existing[0];

    if (!thread) {
      const [created] = await db
        .insert(dmThreads)
        .values({ participantA: canonA, participantB: canonB })
        .onConflictDoNothing()
        .returning();

      if (!created) {
        const [found] = await db
          .select()
          .from(dmThreads)
          .where(and(eq(dmThreads.participantA, canonA), eq(dmThreads.participantB, canonB)))
          .limit(1);
        thread = found;
      } else {
        thread = created;
      }
    }

    const hasMessages = await db
      .select({ id: dmMessages.id })
      .from(dmMessages)
      .where(eq(dmMessages.threadId, thread.id))
      .limit(1);

    if (hasMessages.length === 0) {
      const reportSummary = formatReportSummary(report);
      const firstBody = reportSummary ??
        `Hi! I'd like to discuss ${propertyAddress} with you — the AI analysis shows development potential and I'd love your professional input.`;

      await db.insert(dmMessages).values({
        threadId: thread.id,
        senderId: userId,
        body: firstBody,
      });

      await db.insert(dmMessages).values({
        threadId: thread.id,
        senderId: userId,
        body: "Can you please take a look at this for me?",
      });

      await db
        .update(dmThreads)
        .set({ lastMessageAt: new Date() })
        .where(eq(dmThreads.id, thread.id));
    }

    await db
      .update(serviceProviderProfiles)
      .set({
        recommendationCount: sql`${serviceProviderProfiles.recommendationCount} + 1`,
      })
      .where(eq(serviceProviderProfiles.userId, providerId))
      .catch(() => {});

    try {
      const providerTokens = await db
        .select({ token: pushTokens.token })
        .from(pushTokens)
        .where(eq(pushTokens.userId, providerId));

      if (providerTokens.length > 0) {
        const [sender] = await db
          .select({ fullName: profiles.fullName })
          .from(profiles)
          .where(eq(profiles.id, userId))
          .limit(1);

        await sendExpoPush(
          providerTokens.map((t) => t.token),
          "New connection request",
          `A user wants to discuss ${propertyAddress}`,
          { type: "new_connection", address: propertyAddress, threadId: thread.id },
        );
      }
    } catch {}

    res.json({ threadId: thread.id });
  } catch (err) {
    req.log.error({ err }, "POST /recommendations/connect failed");
    res.status(500).json({ error: "Connect failed" });
  }
});

export default router;
