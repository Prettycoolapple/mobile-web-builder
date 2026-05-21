import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, profiles, supportRequests } from "@workspace/db";
import { sendOwnerNotification } from "../lib/mailer";

const router = Router();

router.post("/support", async (req, res) => {
  const { email, phone, message } = req.body as {
    email?: string;
    phone?: string;
    message?: string;
  };

  if (!message || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (!email || !email.trim()) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const trimmedEmail = email.trim();
  const trimmedPhone = phone?.trim() || null;
  const trimmedMessage = message.trim();

  // Best-effort: look up the submitter's profile by email so admin can back-reference.
  let userId: string | null = null;
  try {
    const [match] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, trimmedEmail.toLowerCase()))
      .limit(1);
    if (match) userId = match.id;
  } catch {
    // If profile lookup fails, persist without userId.
  }

  try {
    await db.insert(supportRequests).values({
      userId,
      email: trimmedEmail,
      phone: trimmedPhone,
      message: trimmedMessage,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to persist support request");
    // Continue — the email send is still valuable.
  }

  const subject = `[Project Alpha] Support request from ${trimmedEmail}`;

  const body = [
    "New support request via the Project Alpha mobile app.",
    "",
    `Email:   ${trimmedEmail}`,
    `Phone:   ${trimmedPhone ?? "(not provided)"}`,
    "",
    "--- Message ---",
    trimmedMessage,
    "---------------",
  ].join("\n");

  try {
    await sendOwnerNotification(subject, body);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to send support message. Please try again." });
  }
});

export default router;
