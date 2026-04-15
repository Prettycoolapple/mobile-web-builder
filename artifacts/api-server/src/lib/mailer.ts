import nodemailer from "nodemailer";

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_TO = process.env.SMTP_TO;

function isConfigured(): boolean {
  return !!(SMTP_USER && SMTP_PASS && SMTP_TO);
}

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }
  return _transporter;
}

export async function sendOwnerNotification(subject: string, body: string): Promise<void> {
  if (!isConfigured()) {
    return;
  }
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"Lecorb Notifications" <${SMTP_USER}>`,
      to: SMTP_TO,
      subject,
      text: body,
    });
  } catch {
  }
}
