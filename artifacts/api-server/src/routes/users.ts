import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, or, sql } from "drizzle-orm";
import {
  db,
  profiles,
  salesAgentProfiles,
  serviceProviderProfiles,
  recommendations,
  dmThreads,
  limTitleRequests,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

async function countRecommendationsForUser(userId: string): Promise<number> {
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recommendations)
    .where(eq(recommendations.toUserId, userId));
  return countRow?.count ?? 0;
}

async function hasDmRelationship(viewerId: string, targetUserId: string): Promise<boolean> {
  const [thread] = await db
    .select({ id: dmThreads.id })
    .from(dmThreads)
    .where(
      or(
        and(eq(dmThreads.participantA, viewerId), eq(dmThreads.participantB, targetUserId)),
        and(eq(dmThreads.participantA, targetUserId), eq(dmThreads.participantB, viewerId)),
      ),
    )
    .limit(1);
  return !!thread;
}

async function hasConsentedLeadRelationship(agentId: string, buyerId: string): Promise<boolean> {
  const [lead] = await db
    .select({ id: limTitleRequests.id })
    .from(limTitleRequests)
    .where(and(
      eq(limTitleRequests.matchedAgentUserId, agentId),
      eq(limTitleRequests.requesterUserId, buyerId),
      sql`${limTitleRequests.consentedAt} IS NOT NULL`,
    ))
    .limit(1);
  return Boolean(lead);
}

router.get("/users/:userId", requireAuth, async (req: Request, res: Response) => {
  const viewerId = (req as unknown as { userId: string }).userId;
  const { userId } = req.params;

  try {
    const [profile] = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        role: profiles.role,
        avatarUrl: profiles.avatarUrl,
        isVerified: profiles.isVerified,
        phoneNumber: profiles.phoneNumber,
        email: profiles.email,
        createdAt: profiles.createdAt,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let hasRecommended = false;
    if (viewerId !== userId) {
      const [existing] = await db
        .select({ id: recommendations.id })
        .from(recommendations)
        .where(
          sql`${recommendations.fromUserId} = ${viewerId} AND ${recommendations.toUserId} = ${userId}`,
        )
        .limit(1);
      hasRecommended = !!existing;
    }

    let recommendationCount = 0;
    let roleData: Record<string, unknown> | null = null;

    if (profile.role === "sales_agent") {
      const [agent] = await db
        .select()
        .from(salesAgentProfiles)
        .where(eq(salesAgentProfiles.userId, userId))
        .limit(1);
      if (agent) {
        const canShareContact =
          viewerId !== userId && profile.phoneNumber
            ? await hasDmRelationship(viewerId, userId)
            : false;
        roleData = {
          agencyName: agent.agencyName,
          reaaLicenceNumber: agent.reaaLicenceNumber,
          yearsExperience: agent.yearsExperience,
          regionsCovered: agent.regionsCovered,
          propertyTypes: agent.propertyTypes,
          websiteUrl: agent.websiteUrl,
          bio: agent.bio,
          ...(canShareContact ? { contactNumber: profile.phoneNumber } : {}),
        };
      }
      recommendationCount = await countRecommendationsForUser(userId);
    } else if (profile.role === "service_provider") {
      // Use the denormalized column so admin overrides are reflected immediately.
      const [provider] = await db
        .select()
        .from(serviceProviderProfiles)
        .where(eq(serviceProviderProfiles.userId, userId))
        .limit(1);
      if (provider) {
        recommendationCount = provider.recommendationCount;
        roleData = {
          companyName: provider.companyName,
          nzCompanyRegisterNumber: provider.nzCompanyRegisterNumber,
          discipline: provider.discipline,
          otherDiscipline: provider.otherDiscipline,
          addressStreet: provider.addressStreet ?? null,
          addressSuburb: provider.addressSuburb,
          addressCity: provider.addressCity,
          contactNumber: provider.contactNumber,
          primaryLanguage: provider.primaryLanguage,
          secondaryLanguage: provider.secondaryLanguage,
        };
      }
    } else {
      recommendationCount = await countRecommendationsForUser(userId);
      if (profile.role === "general" && viewerId !== userId && profile.phoneNumber) {
        const canShareContact = await hasDmRelationship(viewerId, userId);
        if (canShareContact) {
          // Contact-phone access predates LIM/title leads. Keep that existing DM
          // permission working while a deployment is rolling out the new table,
          // or when a non-lead DM is viewed in tests/local development.
          const canShareEmail = await hasConsentedLeadRelationship(viewerId, userId).catch(() => false);
          roleData = {
            contactNumber: profile.phoneNumber,
            ...(canShareEmail ? { contactEmail: profile.email } : {}),
          };
        }
      }
    }

    res.json({
      id: profile.id,
      fullName: profile.fullName,
      role: profile.role,
      avatarUrl: profile.avatarUrl,
      isVerified: profile.isVerified,
      createdAt: profile.createdAt,
      recommendationCount,
      hasRecommended,
      roleData,
    });
  } catch (err) {
    req.log.error({ err }, "GET /users/:userId failed");
    res.status(500).json({ error: "Failed to load profile" });
  }
});

router.post("/users/:userId/recommend", requireAuth, async (req: Request, res: Response) => {
  const fromUserId = (req as unknown as { userId: string }).userId;
  const { userId: toUserId } = req.params;

  if (fromUserId === toUserId) {
    res.status(400).json({ error: "You cannot recommend yourself" });
    return;
  }

  try {
    const [target] = await db
      .select({ id: profiles.id, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, toUserId))
      .limit(1);

    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [existing] = await db
      .select({ id: recommendations.id })
      .from(recommendations)
      .where(
        sql`${recommendations.fromUserId} = ${fromUserId} AND ${recommendations.toUserId} = ${toUserId}`,
      )
      .limit(1);

    const syncRecommendationCount = async (hasRecommended: boolean): Promise<number> => {
      if (target.role !== "service_provider") {
        return countRecommendationsForUser(toUserId);
      }

      const [updated] = await db
        .update(serviceProviderProfiles)
        .set({
          recommendationCount: hasRecommended
            ? sql`recommendation_count + 1`
            : sql`GREATEST(recommendation_count - 1, 0)`,
        })
        .where(eq(serviceProviderProfiles.userId, toUserId))
        .returning({ recommendationCount: serviceProviderProfiles.recommendationCount });
      return updated?.recommendationCount ?? countRecommendationsForUser(toUserId);
    };

    if (existing) {
      await db
        .delete(recommendations)
        .where(
          sql`${recommendations.fromUserId} = ${fromUserId} AND ${recommendations.toUserId} = ${toUserId}`,
        );
      const recommendationCount = await syncRecommendationCount(false);
      res.json({ hasRecommended: false, recommendationCount });
    } else {
      await db.insert(recommendations).values({ fromUserId, toUserId });
      const recommendationCount = await syncRecommendationCount(true);
      res.json({ hasRecommended: true, recommendationCount });
    }
  } catch (err) {
    req.log.error({ err }, "POST /users/:userId/recommend failed");
    res.status(500).json({ error: "Failed to update recommendation" });
  }
});

export default router;
