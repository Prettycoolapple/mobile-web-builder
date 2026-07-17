import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, eq, sql } from "drizzle-orm";
import { db, aiSubdivisionInterestEvents, profiles } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();
const AI_SUBDIVISION_FUNNEL_VERSION = 1;

function resolveAudienceSegment(profile: {
  role: string;
  subscriptionTier: string;
  specialStatus: string | null;
  specialStatusExpiresAt: Date | null;
}): string {
  if (profile.role === "sales_agent") return "sales_agent";
  if (profile.role === "service_provider") return "service_provider";
  if (profile.role === "admin") return "admin";

  const specialStatusActive =
    profile.specialStatus === "friends_family" ||
    (profile.specialStatus === "supercharge" &&
      (!profile.specialStatusExpiresAt ||
        profile.specialStatusExpiresAt.getTime() > Date.now()));
  if (specialStatusActive && profile.specialStatus === "friends_family") {
    return "general_friends_family";
  }
  if (specialStatusActive && profile.specialStatus === "supercharge") {
    return "general_supercharge";
  }
  if (
    profile.subscriptionTier === "standard" ||
    profile.subscriptionTier === "pro"
  ) {
    return "general_standard";
  }
  return "general_free";
}

router.post(
  "/ai-subdivision-interest",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = (req as unknown as { userId: string }).userId;
    const { searchId, propertyAddress } = req.body as {
      searchId?: string | null;
      propertyAddress?: string | null;
    };

    try {
      const [profile] = await db
        .select({
          role: profiles.role,
          subscriptionTier: profiles.subscriptionTier,
          specialStatus: profiles.specialStatus,
          specialStatusExpiresAt: profiles.specialStatusExpiresAt,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      if (!profile) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const audienceSegment = resolveAudienceSegment(profile);
      const [event] = await db
        .insert(aiSubdivisionInterestEvents)
        .values({
          userId,
          searchId:
            typeof searchId === "string" && searchId.trim()
              ? searchId.trim()
              : null,
          propertyAddress:
            typeof propertyAddress === "string" && propertyAddress.trim()
              ? propertyAddress.trim()
              : null,
          funnelVersion: AI_SUBDIVISION_FUNNEL_VERSION,
          audienceSegment,
        })
        .returning({ id: aiSubdivisionInterestEvents.id });

      const [totalRow] = await db
        .select({ total: count() })
        .from(aiSubdivisionInterestEvents)
        .where(
          and(
            eq(aiSubdivisionInterestEvents.userId, userId),
            eq(
              aiSubdivisionInterestEvents.funnelVersion,
              AI_SUBDIVISION_FUNNEL_VERSION,
            ),
          ),
        );

      res.json({
        ok: true,
        id: event?.id,
        total: totalRow?.total ?? 0,
        audienceSegment,
      });
    } catch (err) {
      req.log.error({ err }, "POST /ai-subdivision-interest failed");
      res.status(500).json({ error: "Failed to log AI subdivision interest" });
    }
  },
);

router.post(
  "/ai-subdivision-interest/:eventId/complete",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = (req as unknown as { userId: string }).userId;
    const eventId = String(req.params.eventId ?? "").trim();
    if (!eventId) {
      res.status(400).json({ error: "Event ID is required" });
      return;
    }

    try {
      const [event] = await db
        .update(aiSubdivisionInterestEvents)
        .set({
          completedAt: sql`COALESCE(${aiSubdivisionInterestEvents.completedAt}, now())`,
        })
        .where(
          and(
            eq(aiSubdivisionInterestEvents.id, eventId),
            eq(aiSubdivisionInterestEvents.userId, userId),
            eq(
              aiSubdivisionInterestEvents.funnelVersion,
              AI_SUBDIVISION_FUNNEL_VERSION,
            ),
          ),
        )
        .returning({ completedAt: aiSubdivisionInterestEvents.completedAt });

      if (!event) {
        res
          .status(404)
          .json({ error: "AI subdivision interest event not found" });
        return;
      }
      res.json({ ok: true, completedAt: event.completedAt });
    } catch (err) {
      req.log.error(
        { err },
        "POST /ai-subdivision-interest/:eventId/complete failed",
      );
      res
        .status(500)
        .json({ error: "Failed to complete AI subdivision interest event" });
    }
  },
);

export default router;
