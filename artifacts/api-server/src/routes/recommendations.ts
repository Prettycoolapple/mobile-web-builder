import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, and, sql } from "drizzle-orm";
import {
  db,
  profiles,
  serviceProviderProfiles,
  dmThreads,
  dmMessages,
  pushTokens,
  recommendations,
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
  secondaryLanguage: string | null;
}

interface FeasibilityReport {
  address?: string;
  scores?: { ease?: number; cost?: number; roi?: number };
  lots?: { lots?: number };
  merged?: { zone_code?: string; land_area_sqm?: number };
  scenarios?: Array<{ viable?: boolean }>;
  planning?: { zone_code?: string };
  potential_lots?: number;
  /** Matches mobile `DevelopmentStrategyId`: ROI / strategy panel recommendation */
  recommendedDevelopmentStrategy?: string | null;
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
  suggestedDiscipline: string | null;
}> {
  const zoneCode = report.merged?.zone_code ?? report.planning?.zone_code ?? "";
  const lots = report.lots?.lots ?? report.potential_lots ?? 0;
  const landArea = report.merged?.land_area_sqm ?? 0;
  const ease = report.scores?.ease ?? 0;
  const hasViableScenario = report.scenarios?.some((s) => s.viable) ?? false;

  // Pass the full conversation history (not just the last few messages) so the
  // LLM has complete context for semantic understanding.
  const conversationText = conversationHistory
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 400)}`)
    .join("\n");

  const reportSummary =
    zoneCode || lots > 0 || landArea > 0
      ? `Zone: ${zoneCode || "unknown"}, Potential lots: ${lots}, Land area: ${landArea}m², Ease score: ${ease}/5, ROI viable scenarios: ${hasViableScenario}`
      : "No property report data available";

  // ── Primary: LLM semantic understanding ────────────────────────────────────
  try {
    const prompt = `You are an intent analyser for a New Zealand property development app called Project Alpha.

PROPERTY REPORT SUMMARY:
${reportSummary}

FULL CONVERSATION HISTORY:
${conversationText || "(no conversation yet)"}

TASK:
Determine whether the user is showing genuine interest in property development and/or would benefit from being connected with a professional service provider.

Look for ANY of these signals (explicit OR implicit):
- Development intent: wanting to build, subdivide, redevelop, demolish+rebuild, or renovate
- Asking for professional help: architects, designers, planners, engineers, builders, quantity surveyors, project managers
- Questions about professional fees, costs, timelines, or processes that suggest intent to hire
- Asking about resource consent, building consent, or council approval processes
- Expressing desire to proceed, take action, or start a project
- Asking "who can help me", "where do I find", "do you know anyone", or similar
- Any indication they want expert professional guidance, even indirect

Understand BOTH English and Chinese (Simplified) messages equally.
Chinese signals include: 设计师, 建筑师, 工程师, 推荐, 介绍, 有没有, 找人, 需要帮助, 开发, 建造, etc.

Reply with ONLY valid JSON (no markdown, no explanation):
{
  "recommend": <true|false>,
  "type": <"subdivision"|"newbuild"|"renovation"|"none">,
  "discipline": <"architect_designer"|"planner"|"engineer"|"quantity_surveyor"|"other"|null>,
  "confidence": <0.0 to 1.0>,
  "reason": "<one sentence>"
}

"discipline" must reflect what kind of professional they appear to need; use null when unclear.
Set "recommend": false only when there is clearly no development interest or professional guidance needed.`;

    const llmResult = await ai.models.generateContent({
      model: "deepseek-chat",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 200, temperature: 0 },
    });

    const raw = llmResult.text?.trim() ?? "";
    const cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      shouldRecommend: Boolean(parsed.recommend),
      intentType: (["subdivision", "newbuild", "renovation", "none"] as const).includes(parsed.type)
        ? parsed.type
        : "none",
      confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      reason: parsed.reason ?? "LLM detected development interest",
      suggestedDiscipline: parsed.discipline ?? null,
    };
  } catch {
    // ── Fallback: heuristic signal counting ──────────────────────────────────
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
      "build", "develop", "subdivide", "architect", "builder", "engineer",
      "construction", "consent", "townhouse", "units", "new build",
      "设计师", "建筑师", "工程师", "开发", "建造",
    ];
    const hasKeywordIntent = developerKeywords.some((kw) => recentMessages.includes(kw));

    if (signalCount >= 3 || (hasKeywordIntent && signalCount >= 2)) {
      return {
        shouldRecommend: true,
        intentType: signals.isSubdividable ? "subdivision" : "newbuild",
        confidence: signalCount / 5,
        reason: "Property shows strong development potential (heuristic fallback)",
        suggestedDiscipline: null,
      };
    }

    return { shouldRecommend: false, intentType: "none", confidence: 0, reason: "", suggestedDiscipline: null };
  }
}

async function selectServiceProvider(options?: {
  preferredDiscipline?: string | null;
  /** When set (and `preferredDiscipline` is not), keep providers whose discipline is in this list. */
  disciplineIn?: string[];
  excludeProviderIds?: string[];
}): Promise<ServiceProvider | null> {
  const preferredDiscipline = options?.preferredDiscipline ?? null;
  const disciplineIn = options?.disciplineIn;
  const exclude = new Set((options?.excludeProviderIds ?? []).filter(Boolean));

  /** Same source as GET /users/:id — count of profile "recommend" rows, not the denormalised column. */
  const recommendationCountExpr = sql<number>`coalesce((
    select count(*)::int from ${recommendations} where ${eq(recommendations.toUserId, profiles.id)}
  ), 0)`;

  const baseQuery = db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
      isVerified: profiles.isVerified,
      companyName: serviceProviderProfiles.companyName,
      discipline: serviceProviderProfiles.discipline,
      bio: serviceProviderProfiles.bio,
      recommendationCount: recommendationCountExpr.mapWith(Number),
      contactNumber: serviceProviderProfiles.contactNumber,
      addressSuburb: serviceProviderProfiles.addressSuburb,
      addressCity: serviceProviderProfiles.addressCity,
      primaryLanguage: serviceProviderProfiles.primaryLanguage,
      secondaryLanguage: serviceProviderProfiles.secondaryLanguage,
    })
    .from(profiles)
    .innerJoin(serviceProviderProfiles, eq(serviceProviderProfiles.userId, profiles.id))
    .where(eq(profiles.role, "service_provider"))
    // Promote less-exposed providers while still preferring verified accounts.
    .orderBy(desc(profiles.isVerified), asc(recommendationCountExpr))
    .limit(80);

  const rows = await baseQuery;
  if (rows.length === 0) return null;

  // Filter out providers already recommended in this chat round.
  let candidates = rows.filter((r) => !exclude.has(r.id));

  if (preferredDiscipline) {
    const matched = candidates.filter((r) => r.discipline === preferredDiscipline);
    if (matched.length > 0) candidates = matched;
  } else if (disciplineIn && disciplineIn.length > 0) {
    const allow = new Set(disciplineIn);
    const matched = candidates.filter((r) => r.discipline != null && allow.has(r.discipline));
    if (matched.length > 0) candidates = matched;
  }

  // Priority order:
  // 1) verified providers
  // 2) unverified providers
  const verified = candidates.filter((r) => r.isVerified);
  const unverified = candidates.filter((r) => !r.isVerified);
  const tier = verified.length > 0 ? verified : unverified;
  if (tier.length === 0) return null;

  // Keep some rotation among equally-ranked candidates.
  const top = tier.slice(0, 8);
  const selected = top[Math.floor(Math.random() * top.length)];
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
    secondaryLanguage: selected.secondaryLanguage ?? null,
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

    // Provider recommendations are visible to free users as an upsell;
    // initiating an in-app DM is gated on Standard/Pro by /recommendations/connect.
    const tier = currentUser.subscriptionTier ?? "free";
    const upgradeRequired = tier !== "standard" && tier !== "pro";

    const {
      report,
      conversationHistory,
      explicitRequest = false,
      askForOthers = false,
      preferredDiscipline,
      excludeProviderIds = [],
    } = req.body as {
      report?: FeasibilityReport;
      conversationHistory?: Message[];
      explicitRequest?: boolean;
      askForOthers?: boolean;
      preferredDiscipline?: string;
      excludeProviderIds?: string[];
    };

    // Explicit referral request (user said "recommend someone", "any providers", etc.)
    // — skip all gates and go straight to the database. No report required.
    if (explicitRequest) {
      req.log.info({ preferredDiscipline }, "Explicit recommendation request — bypassing probability and intent gates");
      const strategy = report?.recommendedDevelopmentStrategy ?? null;
      const strategySuggestsDesignProfessional =
        strategy === "demolish_rebuild" || strategy === "refurbish";
      const disciplineIn =
        !preferredDiscipline && strategySuggestsDesignProfessional
          ? (["architect_designer", "planner"] as const)
          : undefined;
      let provider = await selectServiceProvider({
        preferredDiscipline: preferredDiscipline ?? null,
        ...(disciplineIn ? { disciplineIn: [...disciplineIn] } : {}),
        excludeProviderIds,
      });
      if (!provider && disciplineIn && disciplineIn.length > 0) {
        provider = await selectServiceProvider({ excludeProviderIds });
      }
      // External/online recommendation is allowed only when user explicitly asks
      // for others AND there are no internal providers left in this chat round.
      if (!provider && askForOthers) {
        res.json({
          shouldRecommend: false,
          provider: null,
          intentType: "referral",
          reason: "No more internal service providers available in this round",
          allowExternalSearch: true,
          upgradeRequired,
        });
        return;
      }
      res.json({
        shouldRecommend: provider !== null,
        provider,
        intentType: "referral",
        reason: "User explicitly asked for a service provider recommendation",
        allowExternalSearch: false,
        upgradeRequired,
      });
      return;
    }

    if (!report) {
      res.status(400).json({ error: "report is required for non-explicit checks" });
      return;
    }

    const strategy = report.recommendedDevelopmentStrategy ?? null;
    const designProfessionalStrategies = new Set(["demolish_rebuild", "refurbish"]);
    if (strategy && designProfessionalStrategies.has(strategy)) {
      const intentType = strategy === "demolish_rebuild" ? "newbuild" : "renovation";
      const designDisciplines = ["architect_designer", "planner"];
      let provider = await selectServiceProvider({
        disciplineIn: designDisciplines,
        excludeProviderIds,
      });
      if (!provider) {
        provider = await selectServiceProvider({ excludeProviderIds });
      }
      res.json({
        shouldRecommend: provider !== null,
        provider,
        intentType,
        reason: "Recommended development strategy (rebuild or renovate) — design / planning professional",
        allowExternalSearch: false,
        upgradeRequired,
      });
      return;
    }

    const intent = await detectDevelopmentIntent(report, conversationHistory ?? []);

    if (!intent.shouldRecommend) {
      res.json({ shouldRecommend: false, provider: null, intentType: intent.intentType, upgradeRequired });
      return;
    }

    // Prefer DB providers; pass discipline inferred by the LLM for better matching.
    const provider = await selectServiceProvider({
      preferredDiscipline: intent.suggestedDiscipline,
      excludeProviderIds,
    });
    res.json({
      shouldRecommend: provider !== null,
      provider,
      intentType: intent.intentType,
      reason: intent.reason,
      allowExternalSearch: false,
      upgradeRequired,
    });
  } catch (err) {
    req.log.error({ err }, "POST /recommendations/check failed");
    res.status(500).json({ error: "Recommendation check failed" });
  }
});

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
      await db.insert(dmMessages).values({
        threadId: thread.id,
        senderId: userId,
        body: `📍 ${propertyAddress}`,
      });

      await db.insert(dmMessages).values({
        threadId: thread.id,
        senderId: userId,
        body: "Could you please take a look at this for me and let me know if there are any development opportunities — either a subdivision or a demo for a new build?",
      });

      await db
        .update(dmThreads)
        .set({ lastMessageAt: new Date() })
        .where(eq(dmThreads.id, thread.id));
    }

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
