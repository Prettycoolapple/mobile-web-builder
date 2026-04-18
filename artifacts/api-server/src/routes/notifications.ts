import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, profiles, serviceProviderProfiles } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { sendOwnerNotification } from "../lib/mailer";

const router: IRouter = Router();

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
