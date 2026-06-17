import { Router } from "express";
import { and, asc, count, desc, eq, gte, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  db,
  profiles,
  salesAgentProfiles,
  listings,
  serviceProviderProfiles,
  feasibilityJobs,
  agentCallEvents,
  chatLlmFeedback,
  dmThreads,
  propertyCache,
  conversationSyncs,
  abuseEvents,
  withDbRetry,
} from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import { setAbuseFlag } from "../lib/abuse";
import { createStorageReviewToken } from "../lib/storage-review-token";
import { getPublicAppUrl } from "../lib/env";
import { logger } from "../lib/logger";
import { runPropertyPipeline, hasCacheableCore } from "../lib/pipeline";
import { listForRescan, upsertCachedRaw, countCached } from "../lib/property-cache";

const router = Router();

type Bucket = "week" | "month";

function parseBucket(raw: unknown): Bucket {
  return raw === "month" ? "month" : "week";
}

function parseLimit(raw: unknown, fallback = 50, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function parseOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function planLabel(tier: string | null | undefined, role: string | null | undefined): string {
  switch (tier) {
    case "pro":
      return role === "service_provider" ? "Provider Pro Plan" : "Pro Plan";
    case "standard":
      return "Standard Plan";
    case "free":
    default:
      return "General — Free tier";
  }
}

function objectPathFromStorageUrl(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  const relativeMatch = fileUrl.match(/\/api\/storage(\/objects\/[^?#]+)/);
  if (relativeMatch?.[1]) return relativeMatch[1];
  try {
    const parsed = new URL(fileUrl);
    const absoluteMatch = parsed.pathname.match(/\/api\/storage(\/objects\/[^?#]+)/);
    return absoluteMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

function makeReviewUrl(fileUrl: string | null | undefined): string | null {
  const objectPath = objectPathFromStorageUrl(fileUrl);
  if (!objectPath) return null;
  const token = createStorageReviewToken(objectPath);
  return `${getPublicAppUrl()}/api/storage/review${objectPath}?token=${encodeURIComponent(token)}`;
}

// GET /admin/stats/signups?bucket=week|month
router.get("/admin/stats/signups", requireAdmin, async (req, res) => {
  const bucket = parseBucket(req.query.bucket);
  try {
    const result = await db.execute<{
      bucket_start: string;
      count: string;
      general: string;
      sales_agent: string;
      service_provider: string;
    }>(sql`
      SELECT
        date_trunc(${bucket}, created_at) AS bucket_start,
        COUNT(*) AS count,
        SUM(CASE WHEN role = 'general' THEN 1 ELSE 0 END) AS general,
        SUM(CASE WHEN role = 'sales_agent' THEN 1 ELSE 0 END) AS sales_agent,
        SUM(CASE WHEN role = 'service_provider' THEN 1 ELSE 0 END) AS service_provider
      FROM profiles
      WHERE role != 'admin'
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
    `);
    const rows = (result as any).rows ?? result;
    res.json({
      bucket,
      buckets: (rows as any[]).map((r) => ({
        bucketStart: r.bucket_start,
        count: Number(r.count),
        byRole: {
          general: Number(r.general),
          sales_agent: Number(r.sales_agent),
          service_provider: Number(r.service_provider),
        },
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin signups stats failed");
    res.status(500).json({ error: "Failed to load signup stats" });
  }
});

// GET /admin/stats/conversion?bucket=week|month
router.get("/admin/stats/conversion", requireAdmin, async (req, res) => {
  const bucket = parseBucket(req.query.bucket);
  try {
    const result = await db.execute<{
      bucket_start: string;
      signups: string;
      paid_now: string;
    }>(sql`
      SELECT
        date_trunc(${bucket}, created_at) AS bucket_start,
        COUNT(*) AS signups,
        SUM(CASE WHEN subscription_tier IN ('standard', 'pro') THEN 1 ELSE 0 END) AS paid_now
      FROM profiles
      WHERE role != 'admin'
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
    `);
    const rows = (result as any).rows ?? result;
    res.json({
      bucket,
      buckets: (rows as any[]).map((r) => {
        const signups = Number(r.signups);
        const paid = Number(r.paid_now);
        return {
          bucketStart: r.bucket_start,
          signups,
          paidNow: paid,
          conversionRate: signups > 0 ? paid / signups : 0,
        };
      }),
    });
  } catch (err) {
    req.log.error({ err }, "admin conversion stats failed");
    res.status(500).json({ error: "Failed to load conversion stats" });
  }
});

// GET /admin/stats/retention/cohorts?weeks=8
router.get("/admin/stats/retention/cohorts", requireAdmin, async (req, res) => {
  const weeks = (() => {
    const n = Number(req.query.weeks);
    if (!Number.isFinite(n) || n <= 0) return 8;
    return Math.min(Math.floor(n), 26);
  })();

  try {
    const sizesResult = await db.execute<{
      cohort_week: string;
      size: string;
    }>(sql`
      SELECT
        date_trunc('week', created_at) AS cohort_week,
        COUNT(*) AS size
      FROM profiles
      WHERE role != 'admin'
        AND created_at >= now() - (${weeks}::int * INTERVAL '1 week')
      GROUP BY cohort_week
      ORDER BY cohort_week ASC
    `);
    const sizeRows = (sizesResult as any).rows ?? sizesResult;

    const retentionResult = await db.execute<{
      cohort_week: string;
      week_offset: string;
      users_active: string;
    }>(sql`
      WITH cohorts AS (
        SELECT id, date_trunc('week', created_at) AS cohort_week
        FROM profiles
        WHERE role != 'admin'
          AND created_at >= now() - (${weeks}::int * INTERVAL '1 week')
      )
      SELECT
        c.cohort_week,
        FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', e.logged_in_at) - c.cohort_week)) / (7 * 86400))::int AS week_offset,
        COUNT(DISTINCT c.id) AS users_active
      FROM cohorts c
      JOIN user_login_events e ON e.user_id = c.id
      WHERE e.logged_in_at >= c.cohort_week
      GROUP BY c.cohort_week, week_offset
      ORDER BY c.cohort_week ASC, week_offset ASC
    `);
    const retentionRows = (retentionResult as any).rows ?? retentionResult;

    const cohorts = (sizeRows as any[]).map((s) => {
      const size = Number(s.size);
      const retained: number[] = new Array(weeks + 1).fill(0);
      for (const r of retentionRows as any[]) {
        if (r.cohort_week !== s.cohort_week) continue;
        const off = Number(r.week_offset);
        if (off >= 0 && off <= weeks) {
          retained[off] = size > 0 ? Number(r.users_active) / size : 0;
        }
      }
      return {
        cohortWeek: s.cohort_week,
        size,
        retainedByWeekOffset: retained,
      };
    });

    res.json({ weeks, cohorts });
  } catch (err) {
    req.log.error({ err }, "admin retention cohorts failed");
    res.status(500).json({ error: "Failed to load retention cohorts" });
  }
});

// GET /admin/users?search=&limit=&offset=
router.get("/admin/users", requireAdmin, async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);

  try {
    const searchPattern = `%${search}%`;
    const whereClause = search
      ? and(
          sql`${profiles.role} != 'admin'`,
          or(ilike(profiles.email, searchPattern), ilike(profiles.fullName, searchPattern)),
        )
      : sql`${profiles.role} != 'admin'`;

    const rows = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        role: profiles.role,
        subscriptionTier: profiles.subscriptionTier,
        createdAt: profiles.createdAt,
        lastLoginAt: profiles.lastLoginAt,
        isVerified: profiles.isVerified,
        phoneNumber: profiles.phoneNumber,
        specialStatus: profiles.specialStatus,
        specialStatusExpiresAt: profiles.specialStatusExpiresAt,
      })
      .from(profiles)
      .where(whereClause)
      .orderBy(desc(profiles.createdAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total FROM profiles
      WHERE role != 'admin'
        ${search ? sql`AND (email ILIKE ${searchPattern} OR full_name ILIKE ${searchPattern})` : sql``}
    `);
    const totalRows = (totalResult as any).rows ?? totalResult;
    const total = Number((totalRows[0] as any)?.total ?? 0);

    res.json({
      total,
      limit,
      offset,
      rows: rows.map((r) => ({
        ...r,
        planLabel: planLabel(r.subscriptionTier, r.role),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin users list failed");
    res.status(500).json({ error: "Failed to load users" });
  }
});

// GET /admin/inquiries?type=all|report|support&limit=&offset=
router.get("/admin/inquiries", requireAdmin, async (req, res) => {
  const type =
    req.query.type === "report" ? "report" : req.query.type === "support" ? "support" : "all";
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);

  try {
    const items: Array<{
      kind: "report" | "support";
      id: string;
      createdAt: string;
      message: string;
      submitter: {
        id: string | null;
        email: string | null;
        fullName: string | null;
        phone: string | null;
        role: string | null;
        subscriptionTier: string | null;
        planLabel: string;
      };
      reportedUser?: {
        id: string;
        email: string | null;
        fullName: string | null;
        role: string | null;
      } | null;
    }> = [];

    if (type === "report" || type === "all") {
      const result = await db.execute<{
        id: string;
        created_at: string;
        comment: string;
        reporter_id: string;
        reporter_email: string | null;
        reporter_name: string | null;
        reporter_role: string | null;
        reporter_phone: string | null;
        reporter_tier: string | null;
        reported_user_id: string | null;
        reported_email: string | null;
        reported_name: string | null;
        reported_role: string | null;
      }>(sql`
        SELECT
          r.id, r.created_at, r.comment,
          r.reporter_id,
          rep.email AS reporter_email,
          rep.full_name AS reporter_name,
          rep.role AS reporter_role,
          rep.phone_number AS reporter_phone,
          rep.subscription_tier AS reporter_tier,
          r.reported_user_id,
          rpt.email AS reported_email,
          rpt.full_name AS reported_name,
          rpt.role AS reported_role
        FROM user_reports r
        LEFT JOIN profiles rep ON rep.id = r.reporter_id
        LEFT JOIN profiles rpt ON rpt.id = r.reported_user_id
        ORDER BY r.created_at DESC
      `);
      const rows = (result as any).rows ?? result;
      for (const r of rows as any[]) {
        items.push({
          kind: "report",
          id: r.id,
          createdAt: r.created_at,
          message: r.comment,
          submitter: {
            id: r.reporter_id,
            email: r.reporter_email,
            fullName: r.reporter_name,
            phone: r.reporter_phone,
            role: r.reporter_role,
            subscriptionTier: r.reporter_tier,
            planLabel: planLabel(r.reporter_tier, r.reporter_role),
          },
          reportedUser: r.reported_user_id
            ? {
                id: r.reported_user_id,
                email: r.reported_email,
                fullName: r.reported_name,
                role: r.reported_role,
              }
            : null,
        });
      }
    }

    if (type === "support" || type === "all") {
      const result = await db.execute<{
        id: string;
        created_at: string;
        message: string;
        user_id: string | null;
        s_email: string;
        s_phone: string | null;
        p_email: string | null;
        p_name: string | null;
        p_role: string | null;
        p_phone: string | null;
        p_tier: string | null;
      }>(sql`
        SELECT
          s.id, s.created_at, s.message,
          s.user_id,
          s.email AS s_email,
          s.phone AS s_phone,
          p.email AS p_email,
          p.full_name AS p_name,
          p.role AS p_role,
          p.phone_number AS p_phone,
          p.subscription_tier AS p_tier
        FROM support_requests s
        LEFT JOIN profiles p ON p.id = s.user_id
        ORDER BY s.created_at DESC
      `);
      const rows = (result as any).rows ?? result;
      for (const r of rows as any[]) {
        items.push({
          kind: "support",
          id: r.id,
          createdAt: r.created_at,
          message: r.message,
          submitter: {
            id: r.user_id,
            email: r.p_email ?? r.s_email,
            fullName: r.p_name,
            phone: r.p_phone ?? r.s_phone,
            role: r.p_role,
            subscriptionTier: r.p_tier,
            planLabel: planLabel(r.p_tier, r.p_role),
          },
          reportedUser: null,
        });
      }
    }

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const total = items.length;
    const paginated = items.slice(offset, offset + limit);

    res.json({ total, limit, offset, type, rows: paginated });
  } catch (err) {
    req.log.error({ err }, "admin inquiries list failed");
    res.status(500).json({ error: "Failed to load inquiries" });
  }
});

// GET /admin/providers/pending
router.get("/admin/providers/pending", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select({
        userId: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        phoneNumber: profiles.phoneNumber,
        createdAt: profiles.createdAt,
        companyName: serviceProviderProfiles.companyName,
        nzCompanyRegisterNumber: serviceProviderProfiles.nzCompanyRegisterNumber,
        discipline: serviceProviderProfiles.discipline,
        otherDiscipline: serviceProviderProfiles.otherDiscipline,
        addressStreet: serviceProviderProfiles.addressStreet,
        addressSuburb: serviceProviderProfiles.addressSuburb,
        addressCity: serviceProviderProfiles.addressCity,
        addressPostcode: serviceProviderProfiles.addressPostcode,
        contactNumber: serviceProviderProfiles.contactNumber,
        languages: serviceProviderProfiles.languages,
        primaryLanguage: serviceProviderProfiles.primaryLanguage,
        secondaryLanguage: serviceProviderProfiles.secondaryLanguage,
        bio: serviceProviderProfiles.bio,
        incorporationCertUrl: serviceProviderProfiles.incorporationCertUrl,
      })
      .from(profiles)
      .innerJoin(serviceProviderProfiles, eq(serviceProviderProfiles.userId, profiles.id))
      .where(and(eq(profiles.role, "service_provider"), eq(profiles.isVerified, false)))
      .orderBy(desc(profiles.createdAt));

    res.json({
      total: rows.length,
      rows: rows.map((r) => ({
        userId: r.userId,
        email: r.email,
        fullName: r.fullName,
        phoneNumber: r.phoneNumber,
        createdAt: r.createdAt,
        company: {
          name: r.companyName,
          nzRegisterNumber: r.nzCompanyRegisterNumber,
          discipline: r.discipline,
          otherDiscipline: r.otherDiscipline,
          address: {
            street: r.addressStreet,
            suburb: r.addressSuburb,
            city: r.addressCity,
            postcode: r.addressPostcode,
          },
          contactNumber: r.contactNumber,
          languages: r.languages,
          primaryLanguage: r.primaryLanguage,
          secondaryLanguage: r.secondaryLanguage,
          bio: r.bio,
        },
        incorporationCertUrl: r.incorporationCertUrl,
        incorporationCertReviewUrl: makeReviewUrl(r.incorporationCertUrl),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin pending providers failed");
    res.status(500).json({ error: "Failed to load pending providers" });
  }
});

// POST /admin/providers/:userId/verify
router.post("/admin/providers/:userId/verify", requireAdmin, async (req, res) => {
  const userId = req.params.userId;
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    const updated = await db
      .update(profiles)
      .set({ isVerified: true })
      .where(and(eq(profiles.id, userId), eq(profiles.role, "service_provider")))
      .returning({ id: profiles.id, isVerified: profiles.isVerified });

    if (updated.length === 0) {
      res.status(404).json({ error: "Service provider not found" });
      return;
    }

    res.json({ ok: true, userId: updated[0].id, isVerified: updated[0].isVerified });
  } catch (err) {
    req.log.error({ err }, "admin verify provider failed");
    res.status(500).json({ error: "Failed to verify provider" });
  }
});

// PATCH /admin/users/:userId/recommendation-count
// Body: { count: number }  — sets the recommendation count for a service_provider
router.patch("/admin/users/:userId/recommendation-count", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { count } = req.body as { count?: unknown };

  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    res.status(400).json({ error: "count must be a non-negative integer" });
    return;
  }

  try {
    const [profile] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (profile.role !== "service_provider") {
      res.status(400).json({ error: "User is not a service provider" });
      return;
    }

    const updated = await db
      .update(serviceProviderProfiles)
      .set({ recommendationCount: count })
      .where(eq(serviceProviderProfiles.userId, userId))
      .returning({ recommendationCount: serviceProviderProfiles.recommendationCount });

    if (updated.length === 0) {
      res.status(404).json({ error: "Service provider profile not found" });
      return;
    }

    res.json({ ok: true, recommendationCount: updated[0].recommendationCount });
  } catch (err) {
    req.log.error({ err }, "admin set recommendation count failed");
    res.status(500).json({ error: "Failed to update recommendation count" });
  }
});

// PATCH /admin/users/:userId/status
// Body: { status: "free" | "supercharge" | "friends_family" }
// "supercharge"    → 60 reports/month, expires 6 months from now
// "friends_family" → 9999 reports/month, no expiry
// "free"           → clear special status, normal plan limits apply
router.patch("/admin/users/:userId/status", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { status } = req.body as { status?: unknown };

  if (status !== "free" && status !== "supercharge" && status !== "friends_family") {
    res.status(400).json({ error: 'status must be "free", "supercharge", or "friends_family"' });
    return;
  }

  let specialStatus: string | null;
  let specialStatusExpiresAt: Date | null;

  if (status === "supercharge") {
    specialStatus = "supercharge";
    const exp = new Date();
    exp.setMonth(exp.getMonth() + 6);
    specialStatusExpiresAt = exp;
  } else if (status === "friends_family") {
    specialStatus = "friends_family";
    specialStatusExpiresAt = null;
  } else {
    specialStatus = null;
    specialStatusExpiresAt = null;
  }

  try {
    const result = await db
      .update(profiles)
      .set({ specialStatus, specialStatusExpiresAt })
      .where(eq(profiles.id, userId))
      .returning({ id: profiles.id, specialStatus: profiles.specialStatus, specialStatusExpiresAt: profiles.specialStatusExpiresAt });

    if (result.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ ok: true, ...result[0] });
  } catch (err) {
    req.log.error({ err }, "admin set user status failed");
    res.status(500).json({ error: "Failed to update user status" });
  }
});

// ============================================================
// Per-user analytics — detail page + paginated sub-lists
// ============================================================

// GET /admin/users/:userId  → profile + counts
router.get("/admin/users/:userId", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    const [profile] = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        role: profiles.role,
        languages: profiles.languages,
        phoneNumber: profiles.phoneNumber,
        subscriptionTier: profiles.subscriptionTier,
        specialStatus: profiles.specialStatus,
        specialStatusExpiresAt: profiles.specialStatusExpiresAt,
        isVerified: profiles.isVerified,
        createdAt: profiles.createdAt,
        lastLoginAt: profiles.lastLoginAt,
        reportsUsedThisMonth: profiles.reportsUsedThisMonth,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const countsResult = await db.execute<{
      feasibility_reports: string;
      agent_calls: string;
      thumbs_down: string;
      recommendation_count: string | null;
      dm_connections: string;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM feasibility_jobs WHERE user_id = ${userId}) AS feasibility_reports,
        (SELECT COUNT(*) FROM agent_call_events WHERE user_id = ${userId}) AS agent_calls,
        (SELECT COUNT(*) FROM chat_llm_feedback WHERE user_id = ${userId} AND rating = 'down') AS thumbs_down,
        (SELECT recommendation_count FROM service_provider_profiles WHERE user_id = ${userId}) AS recommendation_count,
        (SELECT COUNT(*) FROM dm_threads WHERE participant_a = ${userId} OR participant_b = ${userId}) AS dm_connections
    `);
    const countsRows = (countsResult as any).rows ?? countsResult;
    const c = (countsRows[0] ?? {}) as Record<string, string | null>;
    const feasibilityReports = Number(c.feasibility_reports ?? 0);
    const agentCalls = Number(c.agent_calls ?? 0);
    const thumbsDown = Number(c.thumbs_down ?? 0);
    const callsPerReport = feasibilityReports > 0 ? agentCalls / feasibilityReports : 0;
    const recommendationCount = c.recommendation_count != null ? Number(c.recommendation_count) : null;
    const dmConnections = Number(c.dm_connections ?? 0);

    res.json({
      profile: {
        ...profile,
        planLabel: planLabel(profile.subscriptionTier, profile.role),
      },
      counts: {
        feasibilityReports,
        agentCalls,
        thumbsDown,
        callsPerReport,
        recommendationCount,
        dmConnections,
      },
    });
  } catch (err) {
    req.log.error({ err }, "admin user detail failed");
    res.status(500).json({ error: "Failed to load user" });
  }
});

// GET /admin/users/:userId/feedback  → thumbs-down rows
router.get("/admin/users/:userId/feedback", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const limit = parseLimit(req.query.limit, 20, 100);
  const offset = parseOffset(req.query.offset);

  try {
    const rows = await db
      .select({
        id: chatLlmFeedback.id,
        createdAt: chatLlmFeedback.createdAt,
        responseMode: chatLlmFeedback.responseMode,
        reason: chatLlmFeedback.reason,
      })
      .from(chatLlmFeedback)
      .where(and(eq(chatLlmFeedback.userId, userId), eq(chatLlmFeedback.rating, "down")))
      .orderBy(desc(chatLlmFeedback.createdAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total FROM chat_llm_feedback
      WHERE user_id = ${userId} AND rating = 'down'
    `);
    const totalRows = (totalResult as any).rows ?? totalResult;
    const total = Number((totalRows[0] as any)?.total ?? 0);

    res.json({ total, limit, offset, rows });
  } catch (err) {
    req.log.error({ err }, "admin user feedback list failed");
    res.status(500).json({ error: "Failed to load feedback" });
  }
});

// GET /admin/users/:userId/addresses  → feasibility_jobs rows
router.get("/admin/users/:userId/addresses", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const limit = parseLimit(req.query.limit, 20, 100);
  const offset = parseOffset(req.query.offset);

  try {
    const rows = await db
      .select({
        id: feasibilityJobs.id,
        createdAt: feasibilityJobs.createdAt,
        queryAddress: feasibilityJobs.queryAddress,
        analysisAddress: feasibilityJobs.analysisAddress,
        status: feasibilityJobs.status,
      })
      .from(feasibilityJobs)
      .where(eq(feasibilityJobs.userId, userId))
      .orderBy(desc(feasibilityJobs.createdAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total FROM feasibility_jobs WHERE user_id = ${userId}
    `);
    const totalRows = (totalResult as any).rows ?? totalResult;
    const total = Number((totalRows[0] as any)?.total ?? 0);

    res.json({ total, limit, offset, rows });
  } catch (err) {
    req.log.error({ err }, "admin user addresses list failed");
    res.status(500).json({ error: "Failed to load addresses" });
  }
});

// GET /admin/users/:userId/agent-calls  → agent_call_events rows
router.get("/admin/users/:userId/agent-calls", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const limit = parseLimit(req.query.limit, 20, 100);
  const offset = parseOffset(req.query.offset);

  try {
    const rows = await db
      .select({
        id: agentCallEvents.id,
        createdAt: agentCallEvents.createdAt,
        agentName: agentCallEvents.agentName,
        agencyName: agentCallEvents.agencyName,
        agentPhone: agentCallEvents.agentPhone,
        propertyAddress: agentCallEvents.propertyAddress,
      })
      .from(agentCallEvents)
      .where(eq(agentCallEvents.userId, userId))
      .orderBy(desc(agentCallEvents.createdAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total FROM agent_call_events WHERE user_id = ${userId}
    `);
    const totalRows = (totalResult as any).rows ?? totalResult;
    const total = Number((totalRows[0] as any)?.total ?? 0);

    res.json({ total, limit, offset, rows });
  } catch (err) {
    req.log.error({ err }, "admin user agent-calls list failed");
    res.status(500).json({ error: "Failed to load agent calls" });
  }
});

// GET /admin/users/:userId/connections  → DM threads (service-provider connections)
router.get("/admin/users/:userId/connections", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const limit = parseLimit(req.query.limit, 20, 100);
  const offset = parseOffset(req.query.offset);

  try {
    // Fetch threads where this user is either participant, joined with the OTHER participant's profile.
    const rows = await db.execute<{
      thread_id: string;
      connected_at: string;
      last_message_at: string | null;
      other_id: string;
      other_email: string;
      other_full_name: string | null;
      other_role: string;
    }>(sql`
      SELECT
        t.id                                                            AS thread_id,
        t.created_at                                                    AS connected_at,
        t.last_message_at                                               AS last_message_at,
        p.id                                                            AS other_id,
        p.email                                                         AS other_email,
        p.full_name                                                     AS other_full_name,
        p.role                                                          AS other_role
      FROM dm_threads t
      JOIN profiles p
        ON p.id = CASE WHEN t.participant_a = ${userId} THEN t.participant_b ELSE t.participant_a END
      WHERE t.participant_a = ${userId} OR t.participant_b = ${userId}
      ORDER BY t.last_message_at DESC NULLS LAST, t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const rawRows = (rows as any).rows ?? rows;

    const totalResult = await db.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total FROM dm_threads
      WHERE participant_a = ${userId} OR participant_b = ${userId}
    `);
    const totalRows = (totalResult as any).rows ?? totalResult;
    const total = Number((totalRows[0] as any)?.total ?? 0);

    res.json({
      total,
      limit,
      offset,
      rows: rawRows.map((r: any) => ({
        threadId: r.thread_id,
        connectedAt: r.connected_at,
        lastMessageAt: r.last_message_at ?? null,
        otherId: r.other_id,
        otherEmail: r.other_email,
        otherFullName: r.other_full_name ?? null,
        otherRole: r.other_role,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin user connections list failed");
    res.status(500).json({ error: "Failed to load connections" });
  }
});

// ============================================================
// Global stats — Dashboard tiles + top addresses
// ============================================================

// GET /admin/stats/global-counts
router.get("/admin/stats/global-counts", requireAdmin, async (req, res) => {
  try {
    const result = await db.execute<{
      total_reports: string;
      total_agent_calls: string;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM feasibility_jobs) AS total_reports,
        (SELECT COUNT(*) FROM agent_call_events) AS total_agent_calls
    `);
    const rows = (result as any).rows ?? result;
    const r = (rows[0] ?? {}) as Record<string, string>;
    const totalReports = Number(r.total_reports ?? 0);
    const totalAgentCalls = Number(r.total_agent_calls ?? 0);
    res.json({
      totalReports,
      totalAgentCalls,
      callsPerReport: totalReports > 0 ? totalAgentCalls / totalReports : 0,
    });
  } catch (err) {
    req.log.error({ err }, "admin global counts failed");
    res.status(500).json({ error: "Failed to load global counts" });
  }
});

// GET /admin/stats/top-addresses?limit=10&offset=0
router.get("/admin/stats/top-addresses", requireAdmin, async (req, res) => {
  const limit = parseLimit(req.query.limit, 10, 100);
  const offset = parseOffset(req.query.offset);

  try {
    const result = await db.execute<{ address: string; count: string }>(sql`
      SELECT
        LOWER(TRIM(COALESCE(NULLIF(TRIM(analysis_address), ''), query_address))) AS address,
        COUNT(*) AS count
      FROM feasibility_jobs
      WHERE COALESCE(NULLIF(TRIM(analysis_address), ''), query_address) IS NOT NULL
      GROUP BY address
      ORDER BY count DESC, address ASC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = (result as any).rows ?? result;

    const totalResult = await db.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total FROM (
        SELECT LOWER(TRIM(COALESCE(NULLIF(TRIM(analysis_address), ''), query_address))) AS address
        FROM feasibility_jobs
        WHERE COALESCE(NULLIF(TRIM(analysis_address), ''), query_address) IS NOT NULL
        GROUP BY address
      ) t
    `);
    const totalRows = (totalResult as any).rows ?? totalResult;
    const total = Number((totalRows[0] as any)?.total ?? 0);

    res.json({
      total,
      limit,
      offset,
      rows: (rows as any[]).map((r) => ({
        address: r.address,
        count: Number(r.count),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin top addresses failed");
    res.status(500).json({ error: "Failed to load top addresses" });
  }
});

// ── Global property cache — list ─────────────────────────────────────────────
// GET /admin/property-cache?limit=50&offset=0&search=
router.get("/admin/property-cache", requireAdmin, async (req, res) => {
  const limit = parseLimit(req.query.limit, 50, 200);
  const offset = parseOffset(req.query.offset);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  try {
    const where = search
      ? and(
          ilike(propertyCache.formattedAddress, `%${search}%`),
        )
      : undefined;

    const [rows, totalRows] = await Promise.all([
      withDbRetry(() =>
        db
          .select({
            id: propertyCache.id,
            addressKey: propertyCache.addressKey,
            formattedAddress: propertyCache.formattedAddress,
            suburb: propertyCache.suburb,
            canonicalParcelId: propertyCache.canonicalParcelId,
            pipelineVersion: propertyCache.pipelineVersion,
            hitCount: propertyCache.hitCount,
            refreshCount: propertyCache.refreshCount,
            firstAnalysedAt: propertyCache.firstAnalysedAt,
            lastRefreshedAt: propertyCache.lastRefreshedAt,
            sourceUserId: propertyCache.sourceUserId,
          })
          .from(propertyCache)
          .where(where)
          .orderBy(desc(propertyCache.lastRefreshedAt))
          .limit(limit)
          .offset(offset),
      ),
      withDbRetry(() =>
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(propertyCache)
          .where(where),
      ),
    ]);

    const total = totalRows[0]?.n ?? 0;
    res.json({ total, limit, offset, rows });
  } catch (err) {
    req.log.error({ err }, "admin property-cache list failed");
    res.status(500).json({ error: "Failed to load property cache" });
  }
});

// ── Global property cache rescan ─────────────────────────────────────────────
// Operator-triggered refresh of stored raw property data against live sources.
// Retention is indefinite, so this is the primary freshness mechanism (run it
// every few months). It snapshots the oldest rows first, re-runs the live
// pipeline for each, and upserts the result. A failed/empty re-acquisition is
// skipped so it never overwrites good cached data with nothing. Idempotent and
// safe to run repeatedly — successful refreshes advance lastRefreshedAt, so the
// next run naturally picks up the next-oldest rows.

interface RescanStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  processed: number;
  updated: number;
  failed: number;
  lastError: string | null;
}

let rescanStatus: RescanStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  total: 0,
  processed: 0,
  updated: 0,
  failed: 0,
  lastError: null,
};

async function runPropertyCacheRescan(opts: {
  concurrency: number;
  maxRows: number;
  olderThanDays: number | null;
}): Promise<void> {
  const cutoff =
    opts.olderThanDays && opts.olderThanDays > 0
      ? new Date(Date.now() - opts.olderThanDays * 24 * 60 * 60 * 1000)
      : null;
  rescanStatus = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    processed: 0,
    updated: 0,
    failed: 0,
    lastError: null,
  };
  try {
    // Snapshot the batch up front (oldest-first) so persistently-failing rows —
    // which keep their old lastRefreshedAt — can't be re-selected into an
    // infinite loop within a single run.
    const rows = await listForRescan(opts.maxRows, cutoff);
    rescanStatus.total = rows.length;
    logger.info({ marker: "CACHE_RESCAN_START", total: rows.length, cutoff }, "Property cache rescan started");

    for (let i = 0; i < rows.length; i += opts.concurrency) {
      const slice = rows.slice(i, i + opts.concurrency);
      await Promise.all(
        slice.map(async (row) => {
          try {
            const address = row.formattedAddress ?? null;
            if (!address) {
              rescanStatus.failed++;
              return;
            }
            const result = await runPropertyPipeline(address, {});
            if (hasCacheableCore(result) && result.raw_property) {
              await upsertCachedRaw({
                addressKey: row.addressKey,
                rawData: result.raw_property,
                canonicalParcelId: result.linz_parcel?.parcel_id ?? row.canonicalParcelId,
                canonicalTitleId:
                  result.linz_parcel?.title_no ?? result.linz_title?.title_no ?? row.canonicalTitleId,
                formattedAddress: result.geocode?.formatted ?? row.formattedAddress,
                lat: result.geocode?.lat ?? row.lat,
                lng: result.geocode?.lng ?? row.lng,
                suburb: result.suburb ?? row.suburb,
                sourceUserId: row.sourceUserId,
              });
              rescanStatus.updated++;
            } else {
              // Re-acquisition came back empty — keep the existing cached data.
              rescanStatus.failed++;
            }
          } catch (err) {
            rescanStatus.failed++;
            rescanStatus.lastError = (err as Error).message;
            logger.warn({ err: (err as Error).message, addressKey: row.addressKey }, "Property cache rescan row failed");
          } finally {
            rescanStatus.processed++;
          }
        }),
      );
      logger.info(
        {
          marker: "CACHE_RESCAN_PROGRESS",
          processed: rescanStatus.processed,
          updated: rescanStatus.updated,
          failed: rescanStatus.failed,
          total: rescanStatus.total,
        },
        "Property cache rescan progress",
      );
    }
  } catch (err) {
    rescanStatus.lastError = (err as Error).message;
    logger.error({ err }, "Property cache rescan crashed");
  } finally {
    rescanStatus.running = false;
    rescanStatus.finishedAt = new Date().toISOString();
    logger.info({ marker: "CACHE_RESCAN_DONE", ...rescanStatus }, "Property cache rescan complete");
  }
}

// POST /admin/property-cache/rescan  body: { concurrency?, maxRows?, olderThanDays? }
router.post("/admin/property-cache/rescan", requireAdmin, async (req, res) => {
  if (rescanStatus.running) {
    res.status(409).json({ error: "Rescan already running", status: rescanStatus });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const concurrency = Math.min(Math.max(Math.floor(Number(body.concurrency) || 2), 1), 4);
  const maxRows = Number(body.maxRows) > 0 ? Math.floor(Number(body.maxRows)) : 500;
  const olderThanDays = Number(body.olderThanDays) > 0 ? Math.floor(Number(body.olderThanDays)) : null;
  void runPropertyCacheRescan({ concurrency, maxRows, olderThanDays });
  res.status(202).json({ ok: true, started: true, params: { concurrency, maxRows, olderThanDays } });
});

// GET /admin/property-cache/rescan/status
router.get("/admin/property-cache/rescan/status", requireAdmin, (_req, res) => {
  res.json(rescanStatus);
});

// ─── Agent management ────────────────────────────────────────────────────────

// GET /admin/agents?search=&limit=&offset=
// List all sales agents with listing counts and approval stats.
router.get("/admin/agents", requireAdmin, async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const limit = parseLimit(req.query.limit, 50, 200);
  const offset = parseOffset(req.query.offset);

  try {
    const searchPattern = `%${search}%`;
    const whereClause = search
      ? and(
          sql`${profiles.role} = 'sales_agent'`,
          or(ilike(profiles.email, searchPattern), ilike(profiles.fullName, searchPattern)),
        )
      : sql`${profiles.role} = 'sales_agent'`;

    const rows = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        phoneNumber: profiles.phoneNumber,
        isVerified: profiles.isVerified,
        createdAt: profiles.createdAt,
        agencyName: salesAgentProfiles.agencyName,
        licenceNumber: salesAgentProfiles.reaaLicenceNumber,
        totalListings: sql<number>`(select count(*) from listings l where l.user_id = ${profiles.id})::int`,
        pendingListings: sql<number>`(select count(*) from listings l where l.user_id = ${profiles.id} and l.approved_at is null and l.removed_at is null)::int`,
        approvedListings: sql<number>`(select count(*) from listings l where l.user_id = ${profiles.id} and l.approved_at is not null and l.removed_at is null)::int`,
      })
      .from(profiles)
      .leftJoin(salesAgentProfiles, eq(salesAgentProfiles.userId, profiles.id))
      .where(whereClause)
      .orderBy(desc(profiles.createdAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total FROM profiles
      WHERE role = 'sales_agent'
        ${search ? sql`AND (email ILIKE ${searchPattern} OR full_name ILIKE ${searchPattern})` : sql``}
    `);
    const totalRows = (totalResult as any).rows ?? totalResult;
    const total = Number((totalRows[0] as any)?.total ?? 0);

    res.json({ total, limit, offset, rows });
  } catch (err) {
    req.log.error({ err }, "admin agents list failed");
    res.status(500).json({ error: "Failed to load agents" });
  }
});

// GET /admin/agents/:userId — agent profile + all their listings
router.get("/admin/agents/:userId", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  try {
    const [profile] = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        phoneNumber: profiles.phoneNumber,
        isVerified: profiles.isVerified,
        createdAt: profiles.createdAt,
        lastLoginAt: profiles.lastLoginAt,
        agencyName: salesAgentProfiles.agencyName,
        licenceNumber: salesAgentProfiles.reaaLicenceNumber,
        avatarUrl: profiles.avatarUrl,
      })
      .from(profiles)
      .leftJoin(salesAgentProfiles, eq(salesAgentProfiles.userId, profiles.id))
      .where(and(eq(profiles.id, userId), sql`${profiles.role} = 'sales_agent'`));

    if (!profile) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const agentListings = await db
      .select({
        id: listings.id,
        status: listings.status,
        approvedAt: listings.approvedAt,
        address: listings.address,
        listingType: listings.listingType,
        propertyType: listings.propertyType,
        priceDisplay: listings.priceDisplay,
        priceNzd: listings.priceNzd,
        bedrooms: listings.bedrooms,
        bathrooms: listings.bathrooms,
        imageUrls: listings.imageUrls,
        createdAt: listings.createdAt,
        removedAt: listings.removedAt,
      })
      .from(listings)
      .where(eq(listings.userId, userId))
      .orderBy(desc(listings.createdAt));

    res.json({ profile, listings: agentListings });
  } catch (err) {
    req.log.error({ err }, "admin agent detail failed");
    res.status(500).json({ error: "Failed to load agent" });
  }
});

// GET /admin/listings?status=pending|approved|all&search=&limit=&offset=
// All listings across all agents, with agent info.
router.get("/admin/listings", requireAdmin, async (req, res) => {
  const filter = req.query.status === "approved" ? "approved" : req.query.status === "all" ? "all" : "pending";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const limit = parseLimit(req.query.limit, 50, 200);
  const offset = parseOffset(req.query.offset);

  try {
    const conditions: ReturnType<typeof and>[] = [isNull(listings.removedAt)];
    if (filter === "pending") conditions.push(isNull(listings.approvedAt));
    if (filter === "approved") conditions.push(isNotNull(listings.approvedAt));
    if (search) {
      const p = `%${search}%`;
      conditions.push(
        or(ilike(listings.address, p), ilike(profiles.email, p), ilike(profiles.fullName, p))!,
      );
    }

    const rows = await db
      .select({
        id: listings.id,
        status: listings.status,
        approvedAt: listings.approvedAt,
        address: listings.address,
        listingType: listings.listingType,
        propertyType: listings.propertyType,
        priceDisplay: listings.priceDisplay,
        priceNzd: listings.priceNzd,
        bedrooms: listings.bedrooms,
        bathrooms: listings.bathrooms,
        imageUrls: listings.imageUrls,
        createdAt: listings.createdAt,
        agentId: profiles.id,
        agentEmail: profiles.email,
        agentName: profiles.fullName,
        agencyName: salesAgentProfiles.agencyName,
      })
      .from(listings)
      .innerJoin(profiles, eq(profiles.id, listings.userId))
      .leftJoin(salesAgentProfiles, eq(salesAgentProfiles.userId, listings.userId))
      .where(and(...conditions))
      .orderBy(desc(listings.createdAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total
      FROM listings l
      INNER JOIN profiles p ON p.id = l.user_id
      WHERE l.removed_at IS NULL
        ${filter === "pending" ? sql`AND l.approved_at IS NULL` : filter === "approved" ? sql`AND l.approved_at IS NOT NULL` : sql``}
        ${search ? sql`AND (l.address ILIKE ${"%" + search + "%"} OR p.email ILIKE ${"%" + search + "%"})` : sql``}
    `);
    const totalRows = (totalResult as any).rows ?? totalResult;
    const total = Number((totalRows[0] as any)?.total ?? 0);

    res.json({ total, limit, offset, filter, rows });
  } catch (err) {
    req.log.error({ err }, "admin listings list failed");
    res.status(500).json({ error: "Failed to load listings" });
  }
});

// GET /admin/listings/:id — full listing detail with agent info
router.get("/admin/listings/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [row] = await db
      .select({
        id: listings.id,
        status: listings.status,
        approvedAt: listings.approvedAt,
        listingType: listings.listingType,
        address: listings.address,
        addressStreet: listings.addressStreet,
        addressSuburb: listings.addressSuburb,
        addressCity: listings.addressCity,
        addressPostcode: listings.addressPostcode,
        lat: listings.lat,
        lng: listings.lng,
        propertyType: listings.propertyType,
        bedrooms: listings.bedrooms,
        bathrooms: listings.bathrooms,
        toilets: listings.toilets,
        garages: listings.garages,
        landAreaSqm: listings.landAreaSqm,
        floorAreaSqm: listings.floorAreaSqm,
        titleStatus: listings.titleStatus,
        priceNzd: listings.priceNzd,
        priceDisplay: listings.priceDisplay,
        methodOfSale: listings.methodOfSale,
        listingTitle: listings.listingTitle,
        description: listings.description,
        imageUrls: listings.imageUrls,
        documentUrls: listings.documentUrls,
        features: listings.features,
        createdAt: listings.createdAt,
        updatedAt: listings.updatedAt,
        removedAt: listings.removedAt,
        agentId: profiles.id,
        agentEmail: profiles.email,
        agentName: profiles.fullName,
        agentPhone: profiles.phoneNumber,
        agentAvatarUrl: profiles.avatarUrl,
        agencyName: salesAgentProfiles.agencyName,
        licenceNumber: salesAgentProfiles.reaaLicenceNumber,
      })
      .from(listings)
      .innerJoin(profiles, eq(profiles.id, listings.userId))
      .leftJoin(salesAgentProfiles, eq(salesAgentProfiles.userId, listings.userId))
      .where(eq(listings.id, id));

    if (!row) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }

    res.json({ listing: row });
  } catch (err) {
    req.log.error({ err }, "admin listing detail failed");
    res.status(500).json({ error: "Failed to load listing" });
  }
});

// POST /admin/listings/:id/approve
router.post("/admin/listings/:id/approve", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [updated] = await db
      .update(listings)
      .set({ approvedAt: new Date() })
      .where(eq(listings.id, id))
      .returning({ id: listings.id, approvedAt: listings.approvedAt });
    if (!updated) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }
    res.json({ ok: true, id: updated.id, approvedAt: updated.approvedAt });
  } catch (err) {
    req.log.error({ err }, "admin listing approve failed");
    res.status(500).json({ error: "Failed to approve listing" });
  }
});

// POST /admin/listings/:id/unapprove
router.post("/admin/listings/:id/unapprove", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [updated] = await db
      .update(listings)
      .set({ approvedAt: null })
      .where(eq(listings.id, id))
      .returning({ id: listings.id });
    if (!updated) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }
    res.json({ ok: true, id: updated.id, approvedAt: null });
  } catch (err) {
    req.log.error({ err }, "admin listing unapprove failed");
    res.status(500).json({ error: "Failed to unapprove listing" });
  }
});

// GET /admin/listings/pending-count — for sidebar badge
router.get("/admin/listings/pending-count", requireAdmin, async (_req, res) => {
  try {
    const result = await db.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total FROM listings
      WHERE approved_at IS NULL AND removed_at IS NULL
    `);
    const rows = (result as any).rows ?? result;
    res.json({ total: Number((rows[0] as any)?.total ?? 0) });
  } catch {
    res.json({ total: 0 });
  }
});

// GET /admin/users/:userId/chats — for user detail history
router.get("/admin/users/:userId/chats", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const limit = parseLimit(req.query.limit, 10, 100);
  const offset = parseOffset(req.query.offset);

  try {
    const rows = await db
      .select({
        id: conversationSyncs.id,
        title: conversationSyncs.title,
        clientUpdatedAt: conversationSyncs.clientUpdatedAt,
        createdAt: conversationSyncs.createdAt,
        data: conversationSyncs.data,
      })
      .from(conversationSyncs)
      .where(eq(conversationSyncs.userId, userId))
      .orderBy(desc(conversationSyncs.clientUpdatedAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total FROM conversation_syncs WHERE user_id = ${userId}
    `);
    const totalRows = (totalResult as any).rows ?? totalResult;
    const total = Number((totalRows[0] as any)?.total ?? 0);

    // Parse and extract only user messages
    const processedRows = rows.map((r) => {
      let userMessages: { content: string; createdAt?: string }[] = [];
      try {
        const payload = r.data as any;
        if (payload && Array.isArray(payload.messages)) {
          userMessages = payload.messages
            .filter((m: any) => m.role === "user" && typeof m.content === "string")
            .map((m: any) => ({
              content: m.content,
              createdAt: m.createdAt || m.id,
            }));
        }
      } catch {
        // safe fallback
      }
      return {
        id: r.id,
        title: r.title,
        clientUpdatedAt: r.clientUpdatedAt,
        createdAt: r.createdAt,
        userMessages,
      };
    });

    res.json({ total, limit, offset, rows: processedRows });
  } catch (err) {
    req.log.error({ err }, "admin user chats list failed");
    res.status(500).json({ error: "Failed to load chats" });
  }
});

// ── Abuse / harvest-pattern detection (Layer 2) ──────────────────────────────

// GET /admin/abuse/events?kind=&limit=&offset=  — recent abuse signals
router.get("/admin/abuse/events", requireAdmin, async (req, res) => {
  const kind = typeof req.query.kind === "string" ? req.query.kind.trim() : "";
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);

  try {
    const whereClause = kind ? eq(abuseEvents.kind, kind) : undefined;
    const rows = await db
      .select({
        id: abuseEvents.id,
        userId: abuseEvents.userId,
        ipHash: abuseEvents.ipHash,
        kind: abuseEvents.kind,
        weight: abuseEvents.weight,
        detail: abuseEvents.detail,
        createdAt: abuseEvents.createdAt,
        email: profiles.email,
        fullName: profiles.fullName,
      })
      .from(abuseEvents)
      .leftJoin(profiles, eq(profiles.id, abuseEvents.userId))
      .where(whereClause)
      .orderBy(desc(abuseEvents.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ limit, offset, rows });
  } catch (err) {
    req.log.error({ err }, "admin abuse events list failed");
    res.status(500).json({ error: "Failed to load abuse events" });
  }
});

// GET /admin/abuse/flagged  — accounts currently flagged for abuse
router.get("/admin/abuse/flagged", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        role: profiles.role,
        subscriptionTier: profiles.subscriptionTier,
        createdAt: profiles.createdAt,
        abuseFlagReason: profiles.abuseFlagReason,
        abuseFlaggedAt: profiles.abuseFlaggedAt,
      })
      .from(profiles)
      .where(eq(profiles.abuseFlag, true))
      .orderBy(desc(profiles.abuseFlaggedAt));

    res.json({ rows });
  } catch (err) {
    req.log.error({ err }, "admin flagged accounts list failed");
    res.status(500).json({ error: "Failed to load flagged accounts" });
  }
});

// GET /admin/abuse/suspicious?days=&limit=  — accounts ranked by rolling abuse
// score (sum of signal weights in the window). Surfaces accounts worth a manual
// review/warning *before* any auto-flag fires. A score >= 10 is auto-flag-grade.
router.get("/admin/abuse/suspicious", requireAdmin, async (req, res) => {
  const days = (() => {
    const n = Number(req.query.days);
    if (!Number.isFinite(n) || n <= 0) return 7;
    return Math.min(Math.floor(n), 90);
  })();
  const limit = parseLimit(req.query.limit, 100, 500);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const rows = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        role: profiles.role,
        subscriptionTier: profiles.subscriptionTier,
        createdAt: profiles.createdAt,
        abuseFlag: profiles.abuseFlag,
        abuseFlagReason: profiles.abuseFlagReason,
        abuseFlaggedAt: profiles.abuseFlaggedAt,
        score: sql<number>`coalesce(sum(${abuseEvents.weight}), 0)`,
        signalCount: sql<number>`count(*) filter (where ${abuseEvents.weight} > 0)`,
        lastSignalAt: sql<string>`max(${abuseEvents.createdAt})`,
        kinds: sql<string>`string_agg(distinct ${abuseEvents.kind}, ',')`,
      })
      .from(abuseEvents)
      .innerJoin(profiles, eq(profiles.id, abuseEvents.userId))
      .where(and(isNotNull(abuseEvents.userId), gte(abuseEvents.createdAt, since)))
      .groupBy(profiles.id)
      .having(sql`coalesce(sum(${abuseEvents.weight}), 0) > 0`)
      .orderBy(desc(sql`coalesce(sum(${abuseEvents.weight}), 0)`), desc(sql`max(${abuseEvents.createdAt})`))
      .limit(limit);

    res.json({ days, limit, autoFlagScore: 10, rows });
  } catch (err) {
    req.log.error({ err }, "admin suspicious accounts list failed");
    res.status(500).json({ error: "Failed to load suspicious accounts" });
  }
});

// POST /admin/abuse/flag  — manually set/clear an account's abuse flag
// Body: { userId: string, flag: boolean, reason?: string }
router.post("/admin/abuse/flag", requireAdmin, async (req, res) => {
  const { userId, flag, reason } = req.body as { userId?: unknown; flag?: unknown; reason?: unknown };
  if (typeof userId !== "string" || !userId || typeof flag !== "boolean") {
    res.status(400).json({ error: "userId (string) and flag (boolean) are required" });
    return;
  }

  try {
    const ok = await setAbuseFlag(userId, flag, typeof reason === "string" ? reason : undefined);
    if (!ok) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json({ ok: true, userId, abuseFlag: flag });
  } catch (err) {
    req.log.error({ err }, "admin set abuse flag failed");
    res.status(500).json({ error: "Failed to update abuse flag" });
  }
});

export default router;
