import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  limTitleRequests,
  listingAgentTargets,
  profiles,
  searches,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import {
  consentToLimTitleRequest,
  createOrReuseLimTitleOffer,
  declineLimTitleOffer,
  isProactiveLimTitleSample,
  resolveLeadListingAgent,
} from "../lib/lim-title-leads";
import { detectLimTitleIntent } from "../lib/lim-title-intent";
import {
  isLimTitleFeatureEnabled,
  isLimTitleProactiveEnabled,
  getSalesPortalUrl,
} from "../lib/env";
import { normaliseSelectedListingContext } from "../lib/selected-listing-context";
import { claimPostReportPrompt } from "../lib/post-report-prompt-allocation";

const router = Router();

const listingContextSchema = z
  .record(z.string(), z.unknown())
  .nullable()
  .optional();
const reportContextSchema = z.object({
  reportKey: z.string().trim().min(1).max(240),
  reportHistoryId: z.string().trim().min(1).max(240),
  chatSessionId: z.string().trim().min(1).max(240),
  propertyAddress: z.string().trim().min(3).max(500),
  listingUrl: z.string().trim().url().nullable().optional(),
  listingSource: z.string().trim().max(120).nullable().optional(),
  selectedListingContext: listingContextSchema,
});

type VerifiedReportContext = {
  reportKey: string;
  reportHistoryId: string;
  propertyAddress: string;
  listingUrl: string | null;
  listingSource: string | null;
  selectedListingContext: ReturnType<typeof normaliseSelectedListingContext>;
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolve all SMS-sensitive listing data from the authenticated user's saved
 * report. Request-body listing fields are display hints only and are never
 * trusted as the source of an agent phone number or property identity.
 */
async function verifiedReportContext(
  userId: string,
  input: z.infer<typeof reportContextSchema>,
): Promise<VerifiedReportContext | null> {
  const [saved] = await db
    .select({
      id: searches.id,
      address: searches.address,
      resultJson: searches.resultJson,
    })
    .from(searches)
    .where(
      and(eq(searches.id, input.reportHistoryId), eq(searches.userId, userId)),
    )
    .limit(1);
  if (
    !saved?.resultJson ||
    typeof saved.resultJson !== "object" ||
    Array.isArray(saved.resultJson)
  )
    return null;

  const report = saved.resultJson as Record<string, unknown>;
  if (report.kind === "combined_listing_group") return null;
  const overview =
    report.propertyOverview &&
    typeof report.propertyOverview === "object" &&
    !Array.isArray(report.propertyOverview)
      ? (report.propertyOverview as Record<string, unknown>)
      : {};
  const selectedListingContext = normaliseSelectedListingContext(
    report.selectedListingContext ?? overview.selectedListingContext,
  );
  const propertyAddress =
    nonEmptyString(report.address) ??
    nonEmptyString(overview.address) ??
    nonEmptyString(saved.address);
  if (!propertyAddress) return null;

  return {
    reportKey: saved.id,
    reportHistoryId: saved.id,
    propertyAddress,
    listingUrl:
      selectedListingContext?.listingUrl ?? nonEmptyString(overview.listingUrl),
    listingSource:
      selectedListingContext?.source ?? nonEmptyString(overview.listingSource),
    selectedListingContext,
  };
}

async function requireGeneralUser(
  req: Request,
  res: Response,
): Promise<string | null> {
  const userId = (req as unknown as { userId: string }).userId;
  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!profile || profile.role !== "general") {
    res
      .status(403)
      .json({
        error: "This feature is available to general-user accounts.",
        code: "GENERAL_USER_REQUIRED",
      });
    return null;
  }
  return userId;
}

function offerDto(
  request: typeof limTitleRequests.$inferSelect,
  agent: {
    agentName: string | null;
    agencyName: string | null;
    agentPhone: string;
  },
) {
  return {
    requestId: request.id,
    status: request.status,
    propertyAddress: request.propertyAddress,
    agentName: agent.agentName,
    agencyName: agent.agencyName,
    agentPhoneMasked: agent.agentPhone.replace(/.(?=.{3})/g, "•"),
  };
}

router.post("/lim-title/offers/evaluate", requireAuth, async (req, res) => {
  if (!isLimTitleFeatureEnabled() || !isLimTitleProactiveEnabled()) {
    res.json({ eligible: false, reason: "disabled" });
    return;
  }
  const parsed = reportContextSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid report context", details: parsed.error.issues });
    return;
  }
  const userId = await requireGeneralUser(req, res);
  if (!userId) return;
  const report = await verifiedReportContext(userId, parsed.data);
  if (!report) {
    res.status(404).json({ eligible: false, reason: "saved_report_not_found" });
    return;
  }
  const ctx = report.selectedListingContext;
  if (
    ctx?.isCombinedListing ||
    !isProactiveLimTitleSample(userId, report.reportKey)
  ) {
    res.json({
      eligible: false,
      reason: ctx?.isCombinedListing ? "combined_listing" : "outside_sample",
    });
    return;
  }

  try {
    const [existing] = await db
      .select({ request: limTitleRequests, target: listingAgentTargets })
      .from(limTitleRequests)
      .innerJoin(
        listingAgentTargets,
        eq(listingAgentTargets.id, limTitleRequests.agentTargetId),
      )
      .where(
        and(
          eq(limTitleRequests.requesterUserId, userId),
          eq(limTitleRequests.reportKey, report.reportKey),
        ),
      )
      .limit(1);
    if (existing) {
      res.json({
        eligible: existing.request.status === "offered",
        offer:
          existing.request.status === "offered"
            ? offerDto(existing.request, {
                agentName: existing.target.agentName,
                agencyName: existing.target.agencyName,
                agentPhone: existing.target.phoneNumber,
              })
            : null,
        reason: "already_evaluated",
      });
      return;
    }

    const agent = await resolveLeadListingAgent({
      address: report.propertyAddress,
      listingUrl: report.listingUrl,
      selectedListingContext: ctx,
    });
    if (!agent) {
      res.json({ eligible: false, reason: "no_callable_subject_agent" });
      return;
    }
    const promptClaim = await claimPostReportPrompt({
      requesterUserId: userId,
      reportHistoryId: report.reportHistoryId,
      channel: "lim_title",
    });
    if (promptClaim === "conflict") {
      res.json({ eligible: false, reason: "other_proactive_prompt_selected" });
      return;
    }
    const request = await createOrReuseLimTitleOffer({
      requesterUserId: userId,
      agent,
      reportKey: report.reportKey,
      reportHistoryId: report.reportHistoryId,
      chatSessionId: parsed.data.chatSessionId,
      propertyAddress: report.propertyAddress,
      listingUrl: report.listingUrl,
      listingSource: report.listingSource,
      offerSource: "proactive_15_percent",
      selectedListingContext: ctx,
    });
    res.json({
      eligible: request.status === "offered",
      offer: offerDto(request, agent),
    });
  } catch (error) {
    req.log.error({ error }, "LIM/title proactive evaluation failed");
    res.status(500).json({ error: "Could not evaluate the document offer" });
  }
});

const intentSchema = reportContextSchema.extend({
  requestId: z.string().trim().min(1).nullable().optional(),
  messages: z
    .array(
      z.object({
        role: z.string().trim().min(1),
        content: z.string().max(3000),
      }),
    )
    .max(12),
});

router.post("/lim-title/intent", requireAuth, async (req, res) => {
  if (!isLimTitleFeatureEnabled()) {
    res.json({ intent: "unclear", reason: "disabled" });
    return;
  }
  const parsed = intentSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid intent context", details: parsed.error.issues });
    return;
  }
  const userId = await requireGeneralUser(req, res);
  if (!userId) return;

  try {
    const report = await verifiedReportContext(userId, parsed.data);
    if (!report) {
      res
        .status(404)
        .json({
          intent: "unclear",
          available: false,
          reason: "Saved report not found.",
        });
      return;
    }
    let activeRequest: typeof limTitleRequests.$inferSelect | null = null;
    if (parsed.data.requestId) {
      [activeRequest] = await db
        .select()
        .from(limTitleRequests)
        .where(
          and(
            eq(limTitleRequests.id, parsed.data.requestId),
            eq(limTitleRequests.requesterUserId, userId),
            eq(limTitleRequests.status, "offered"),
          ),
        )
        .limit(1);
    }
    const classified = await detectLimTitleIntent({
      messages: parsed.data.messages,
      hasActiveOffer: Boolean(activeRequest),
      propertyAddress: activeRequest?.propertyAddress ?? report.propertyAddress,
    });
    if (classified.intent === "negative") {
      if (activeRequest) await declineLimTitleOffer(activeRequest.id, userId);
      res.json(classified);
      return;
    }
    if (classified.intent !== "positive") {
      res.json(classified);
      return;
    }

    if (activeRequest) {
      const [target] = await db
        .select()
        .from(listingAgentTargets)
        .where(eq(listingAgentTargets.id, activeRequest.agentTargetId))
        .limit(1);
      res.json({
        ...classified,
        offer: target
          ? offerDto(activeRequest, {
              agentName: target.agentName,
              agencyName: target.agencyName,
              agentPhone: target.phoneNumber,
            })
          : null,
      });
      return;
    }

    const ctx = report.selectedListingContext;
    if (ctx?.isCombinedListing) {
      res.json({
        ...classified,
        available: false,
        reason: "Combined listings are not supported yet.",
      });
      return;
    }
    const agent = await resolveLeadListingAgent({
      address: report.propertyAddress,
      listingUrl: report.listingUrl,
      selectedListingContext: ctx,
    });
    if (!agent) {
      res.json({
        ...classified,
        available: false,
        reason: "No active listing agent with an SMS-capable mobile was found.",
      });
      return;
    }
    const request = await createOrReuseLimTitleOffer({
      requesterUserId: userId,
      agent,
      reportKey: report.reportKey,
      reportHistoryId: report.reportHistoryId,
      chatSessionId: parsed.data.chatSessionId,
      propertyAddress: report.propertyAddress,
      listingUrl: report.listingUrl,
      listingSource: report.listingSource,
      offerSource: "organic_intent",
      selectedListingContext: ctx,
      intentReason: classified.reason,
    });
    if (request.consentedAt) {
      res.json({
        ...classified,
        available: true,
        alreadyRequested: true,
        requestStatus: request.status,
        offer: offerDto(request, agent),
      });
      return;
    }
    res.json({
      ...classified,
      available: true,
      alreadyRequested: false,
      offer: offerDto(request, agent),
    });
  } catch (error) {
    req.log.error({ error }, "LIM/title intent classification failed");
    res.status(500).json({ error: "Could not process the document request" });
  }
});

router.post(
  "/lim-title/requests/:requestId/decline",
  requireAuth,
  async (req, res) => {
    const userId = await requireGeneralUser(req, res);
    if (!userId) return;
    const declined = await declineLimTitleOffer(req.params.requestId, userId);
    res
      .status(declined ? 200 : 404)
      .json(declined ? { status: "declined" } : { error: "Offer not found" });
  },
);

router.post(
  "/lim-title/requests/:requestId/consent",
  requireAuth,
  async (req, res) => {
    const userId = await requireGeneralUser(req, res);
    if (!userId) return;
    try {
      const result = await consentToLimTitleRequest(
        req.params.requestId,
        userId,
      );
      res.json({
        requestId: result.request.id,
        status: result.request.status,
        connected: result.connected,
        threadId: result.threadId,
        alreadyConsented: result.alreadyConsented,
      });
    } catch (error) {
      const status =
        Number((error as { statusCode?: number }).statusCode) || 500;
      if (status >= 500) req.log.error({ error }, "LIM/title consent failed");
      res
        .status(status)
        .json({
          error:
            status === 404 ? "Request not found" : "Could not send the request",
        });
    }
  },
);

router.get("/lim-title/requests/:requestId", requireAuth, async (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const [request] = await db
    .select({
      id: limTitleRequests.id,
      status: limTitleRequests.status,
      propertyAddress: limTitleRequests.propertyAddress,
      dmThreadId: limTitleRequests.dmThreadId,
      consentedAt: limTitleRequests.consentedAt,
      connectedAt: limTitleRequests.connectedAt,
    })
    .from(limTitleRequests)
    .where(
      and(
        eq(limTitleRequests.id, req.params.requestId),
        eq(limTitleRequests.requesterUserId, userId),
      ),
    )
    .limit(1);
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  res.json({ request });
});

router.get("/sales-agent/leads", requireAuth, async (req, res) => {
  const agentUserId = (req as unknown as { userId: string }).userId;
  const [agent] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, agentUserId))
    .limit(1);
  if (agent?.role !== "sales_agent") {
    res.status(403).json({ error: "Sales agent account required" });
    return;
  }
  const buyer = profiles;
  const leads = await db
    .select({
      id: limTitleRequests.id,
      status: limTitleRequests.status,
      propertyAddress: limTitleRequests.propertyAddress,
      listingUrl: limTitleRequests.listingUrl,
      requestedDocuments: limTitleRequests.requestedDocuments,
      consentedAt: limTitleRequests.consentedAt,
      connectedAt: limTitleRequests.connectedAt,
      dmThreadId: limTitleRequests.dmThreadId,
      buyerId: buyer.id,
      buyerName: buyer.fullName,
      buyerEmail: buyer.email,
      buyerPhone: buyer.phoneNumber,
    })
    .from(limTitleRequests)
    .innerJoin(buyer, eq(buyer.id, limTitleRequests.requesterUserId))
    .where(
      and(
        eq(limTitleRequests.matchedAgentUserId, agentUserId),
        isNotNull(limTitleRequests.consentedAt),
      ),
    )
    .orderBy(desc(limTitleRequests.consentedAt));
  res.json({ leads });
});

router.get("/l/:token", async (req, res) => {
  // The token only gives the portal a post-login hint. It never authorizes or
  // returns a lead; OTP phone matching remains the sole ownership check.
  const token = String(req.params.token ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 32);
  const portal = new URL(getSalesPortalUrl());
  if (token) portal.searchParams.set("lead", token);
  res.redirect(302, portal.toString());
});

export default router;
