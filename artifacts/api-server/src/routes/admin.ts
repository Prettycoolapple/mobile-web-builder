import { Router } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  profiles,
  serviceProviderProfiles,
  feasibilityJobs,
  agentCallEvents,
  chatLlmFeedback,
} from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import { createStorageReviewToken } from "../lib/storage-review-token";
import { getPublicAppUrl } from "../lib/env";

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
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM feasibility_jobs WHERE user_id = ${userId}) AS feasibility_reports,
        (SELECT COUNT(*) FROM agent_call_events WHERE user_id = ${userId}) AS agent_calls,
        (SELECT COUNT(*) FROM chat_llm_feedback WHERE user_id = ${userId} AND rating = 'down') AS thumbs_down,
        (SELECT recommendation_count FROM service_provider_profiles WHERE user_id = ${userId}) AS recommendation_count
    `);
    const countsRows = (countsResult as any).rows ?? countsResult;
    const c = (countsRows[0] ?? {}) as Record<string, string | null>;
    const feasibilityReports = Number(c.feasibility_reports ?? 0);
    const agentCalls = Number(c.agent_calls ?? 0);
    const thumbsDown = Number(c.thumbs_down ?? 0);
    const callsPerReport = feasibilityReports > 0 ? agentCalls / feasibilityReports : 0;
    const recommendationCount = c.recommendation_count != null ? Number(c.recommendation_count) : null;

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

export default router;
