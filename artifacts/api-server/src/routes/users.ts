import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  profiles,
  salesAgentProfiles,
  serviceProviderProfiles,
  recommendations,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

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
        roleData = {
          agencyName: agent.agencyName,
          reaaLicenceNumber: agent.reaaLicenceNumber,
          yearsExperience: agent.yearsExperience,
          regionsCovered: agent.regionsCovered,
          propertyTypes: agent.propertyTypes,
          websiteUrl: agent.websiteUrl,
          bio: agent.bio,
        };
      }
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(recommendations)
        .where(eq(recommendations.toUserId, userId));
      recommendationCount = countRow?.count ?? 0;
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
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(recommendations)
        .where(eq(recommendations.toUserId, userId));
      recommendationCount = countRow?.count ?? 0;
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
      .select({ id: profiles.id })
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

    if (existing) {
      await db
        .delete(recommendations)
        .where(
          sql`${recommendations.fromUserId} = ${fromUserId} AND ${recommendations.toUserId} = ${toUserId}`,
        );
      // Decrement atomically so admin-set base values are preserved.
      const [updated] = await db
        .update(serviceProviderProfiles)
        .set({ recommendationCount: sql`GREATEST(recommendation_count - 1, 0)` })
        .where(eq(serviceProviderProfiles.userId, toUserId))
        .returning({ recommendationCount: serviceProviderProfiles.recommendationCount });
      const recommendationCount = updated?.recommendationCount ?? 0;
      res.json({ hasRecommended: false, recommendationCount });
    } else {
      await db.insert(recommendations).values({ fromUserId, toUserId });
      // Increment atomically so admin-set base values are preserved.
      const [updated] = await db
        .update(serviceProviderProfiles)
        .set({ recommendationCount: sql`recommendation_count + 1` })
        .where(eq(serviceProviderProfiles.userId, toUserId))
        .returning({ recommendationCount: serviceProviderProfiles.recommendationCount });
      const recommendationCount = updated?.recommendationCount ?? 0;
      res.json({ hasRecommended: true, recommendationCount });
    }
  } catch (err) {
    req.log.error({ err }, "POST /users/:userId/recommend failed");
    res.status(500).json({ error: "Failed to update recommendation" });
  }
});

export default router;
