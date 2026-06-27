import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, notificationItems, profiles, serviceProviderProfiles } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { sendOwnerNotification } from "../lib/mailer";
import {
  getUnreadAppBadgeSummary,
  markNotificationItemRead,
  markNotificationSourceRead,
  type NotificationPage,
} from "../lib/notification-state";

const router: IRouter = Router();

const readablePages = new Set<NotificationPage>(["search", "history"]);

router.get("/notifications/summary", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as unknown as { userId: string }).userId;

  try {
    res.json(await getUnreadAppBadgeSummary(userId));
  } catch (err) {
    req.log.error({ err }, "GET /notifications/summary failed");
    res.status(500).json({ error: "Failed to fetch notification summary" });
  }
});

router.get("/notifications/items", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as unknown as { userId: string }).userId;
  const page = typeof req.query.page === "string" ? req.query.page : "";

  if (!readablePages.has(page as NotificationPage)) {
    res.status(400).json({ error: "page must be search or history" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(notificationItems)
      .where(and(eq(notificationItems.userId, userId), eq(notificationItems.page, page), isNull(notificationItems.readAt)))
      .orderBy(desc(notificationItems.createdAt))
      .limit(50);

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        sourceId: row.sourceId,
        page: row.page,
        title: row.title,
        body: row.body,
        metadata: row.metadataJson,
        createdAt: row.createdAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "GET /notifications/items failed");
    res.status(500).json({ error: "Failed to fetch notification items" });
  }
});

router.patch("/notifications/items/:id/read", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as unknown as { userId: string }).userId;

  try {
    await markNotificationItemRead(userId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "PATCH /notifications/items/:id/read failed");
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

router.patch("/notifications/sources/:kind/:sourceId/read", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as unknown as { userId: string }).userId;
  const { kind, sourceId } = req.params;

  try {
    await markNotificationSourceRead(userId, kind, sourceId);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "PATCH /notifications/sources/:kind/:sourceId/read failed");
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

router.post("/notifications/provider-subscribed", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as unknown as { userId: string }).userId;

  try {
    const [profile] = await db
      .select({ id: profiles.id, fullName: profiles.fullName, email: profiles.email, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile || profile.role !== "service_provider") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [providerProfile] = await db
      .select()
      .from(serviceProviderProfiles)
      .where(eq(serviceProviderProfiles.userId, userId))
      .limit(1);

    const subject = `New service provider subscription: ${profile.fullName ?? profile.email}`;
    const body = [
      `A new service provider has subscribed on Project Alpha.`,
      ``,
      `Name: ${profile.fullName ?? "Unknown"}`,
      `Email: ${profile.email}`,
      `Company: ${providerProfile?.companyName ?? "Not provided"}`,
      `Discipline: ${providerProfile?.discipline ?? "Not provided"}${providerProfile?.otherDiscipline ? ` (${providerProfile.otherDiscipline})` : ""}`,
      `Contact: ${providerProfile?.contactNumber ?? "Not provided"}`,
      `Primary Language: ${providerProfile?.primaryLanguage ?? "Not provided"}`,
      `City: ${providerProfile?.addressCity ?? "Not provided"}`,
      `NZ Reg Number: ${providerProfile?.nzCompanyRegisterNumber ?? "Not provided"}`,
      ``,
      `To verify this provider, run:`,
      `UPDATE profiles SET is_verified = true WHERE id = '${profile.id}';`,
    ].join("\n");

    await sendOwnerNotification(subject, body);

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /notifications/provider-subscribed failed");
    res.status(500).json({ error: "Failed to send notification" });
  }
});

export default router;
