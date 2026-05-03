import { Router } from "express";
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

  const subject = `[Project Alpha] Support request from ${email.trim()}`;

  const body = [
    "New support request via the Project Alpha mobile app.",
    "",
    `Email:   ${email.trim()}`,
    `Phone:   ${phone?.trim() || "(not provided)"}`,
    "",
    "--- Message ---",
    message.trim(),
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
