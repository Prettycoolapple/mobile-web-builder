import nodemailer from "nodemailer";

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_TO = process.env.SMTP_TO;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
/** Must be an address on a domain verified in Resend (e.g. Project Alpha <no-reply@yourdomain.com>). */
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
/** Optional full URL to your public support / contact page, included in transactional emails. */
const PUBLIC_SUPPORT_URL = process.env.PUBLIC_SUPPORT_URL?.trim();

function passwordResetEmailFooter(): { textBlock: string; htmlBlock: string } {
  const textLines = [
    "—",
    "This email was sent automatically by Project Alpha. Please do not reply to this message — this address is not monitored and your reply will not reach our team.",
    "Need help? Open the Project Alpha app, go to the Account tab, then tap Contact support.",
  ];
  if (PUBLIC_SUPPORT_URL) {
    textLines.push(`You can also reach us on our website: ${PUBLIC_SUPPORT_URL}`);
  }

  const htmlBlocks: string[] = [
    `<hr style="border:none;border-top:1px solid #e7e5e4;margin:24px 0" />`,
    `<p style="font-size:13px;color:#78716c;line-height:1.5">This email was sent automatically by <strong>Project Alpha</strong>. <strong>Please do not reply</strong> — this address is not monitored and your reply will not reach our team.</p>`,
    `<p style="font-size:13px;color:#78716c;line-height:1.5">Need help? Open the Project Alpha app, go to the <strong>Account</strong> tab, then tap <strong>Contact support</strong>.</p>`,
  ];
  if (PUBLIC_SUPPORT_URL) {
    const href = PUBLIC_SUPPORT_URL.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const safe = PUBLIC_SUPPORT_URL.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    htmlBlocks.push(
      `<p style="font-size:13px;color:#78716c;line-height:1.5">You can also reach us on our website: <a href="${href}" style="color:#b45309">${safe}</a></p>`,
    );
  }

  return {
    textBlock: textLines.join("\n"),
    htmlBlock: htmlBlocks.join("\n"),
  };
}

function isOwnerNotificationConfigured(): boolean {
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
  if (!isOwnerNotificationConfigured()) {
    return;
  }
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Project Alpha Notifications" <${SMTP_USER}>`,
    to: SMTP_TO,
    subject,
    text: body,
  });
}

export async function sendPasswordResetCodeEmail(args: {
  to: string;
  code: string;
  expiresInMinutes: number;
}): Promise<boolean> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return false;

  try {
    const footer = passwordResetEmailFooter();
    const text = [
      `Your Project Alpha password reset code is ${args.code}.`,
      ``,
      `It expires in ${args.expiresInMinutes} minutes. If you did not request this, you can ignore this email.`,
      ``,
      footer.textBlock,
    ].join("\n");
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1917">
        <p>Your Project Alpha password reset code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${args.code}</p>
        <p>This code expires in ${args.expiresInMinutes} minutes.</p>
        <p style="color:#78716c">If you did not request this, you can ignore this email.</p>
        ${footer.htmlBlock}
      </div>
    `;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [args.to],
        subject: "Reset your Project Alpha password",
        text,
        html,
      }),
    });

    return resp.ok;
  } catch {
    return false;
  }
}

/** Outcome of an attempt to email a white-label report PDF. */
export type SendReportPdfResult = { ok: true } | { ok: false; error: string };

/**
 * Email a provider's white-label feasibility report PDF to their client (Resend,
 * with the PDF as an attachment). The provider's own email is set as reply-to so
 * the client can respond directly to them. Used by /reports/pdf/email.
 */
export async function sendReportPdfEmail(args: {
  to: string;
  replyTo?: string | null;
  fromName?: string | null;
  subject: string;
  message: string;
  filename: string;
  pdfBase64: string;
}): Promise<SendReportPdfResult> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return { ok: false, error: "Email service is not configured." };
  }

  const safeMessage = htmlEscapeBasic(args.message).replace(/\n/g, "<br/>");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1c1917">
      ${safeMessage || "<p>Please find the attached feasibility report.</p>"}
    </div>
  `;
  // Resend allows overriding the visible sender name while keeping the verified
  // from-address; reply-to routes the client's reply to the provider.
  const fromHeader = args.fromName ? `${sanitizeFromName(args.fromName)} <${stripAngle(RESEND_FROM_EMAIL)}>` : RESEND_FROM_EMAIL;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromHeader,
        to: [args.to],
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
        subject: args.subject,
        text: args.message || "Please find the attached feasibility report.",
        html,
        attachments: [{ filename: args.filename, content: args.pdfBase64 }],
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return { ok: false, error: `Email provider rejected the request (${resp.status}). ${detail}`.trim() };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to send email." };
  }
}

function htmlEscapeBasic(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Strip characters that would break the From display-name in an email header. */
function sanitizeFromName(name: string): string {
  return name.replace(/["\r\n<>]/g, "").trim().slice(0, 80) || "Project Alpha";
}

/** Extract the bare address if RESEND_FROM_EMAIL is in "Name <addr>" form. */
function stripAngle(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return m ? m[1] : from;
}

export type SignupRole = "general" | "sales_agent" | "service_provider";

export function accountTypeLabel(role: SignupRole): string {
  switch (role) {
    case "general":
      return "General user";
    case "sales_agent":
      return "Sales agent";
    case "service_provider":
      return "Service provider";
  }
}

type SignupNotifyAgent = {
  agencyName?: string | null;
  reaaLicenceNumber?: string | null;
  yearsExperience?: number | null;
  websiteUrl?: string | null;
};

type SignupNotifyProvider = {
  companyName?: string | null;
  nzCompanyRegisterNumber?: string | null;
  discipline?: string | null;
  otherDiscipline?: string | null;
  contactNumber?: string | null;
  primaryLanguage?: string | null;
  addressCity?: string | null;
  incorporationCertUrl?: string | null;
  incorporationCertReviewUrl?: string | null;
};

/** Owner alert for any successful self-serve signup (no-op when SMTP is not configured). */
export function sendNewUserSignupNotification(args: {
  role: SignupRole;
  profileId: string;
  email: string;
  fullName: string | null;
  phone: string;
  languages: string[];
  agentData?: SignupNotifyAgent;
  providerData?: SignupNotifyProvider;
}): Promise<void> {
  const type = accountTypeLabel(args.role);
  const who = args.fullName?.trim() || args.email;
  const subject = `New signup — ${type}: ${who}`;

  const lines: string[] = [
    `A new user has registered on Project Alpha.`,
    ``,
    `Account type: ${type}`,
    `Name: ${args.fullName?.trim() || "Not provided"}`,
    `Email: ${args.email}`,
    `Phone: ${args.phone}`,
    `Languages: ${args.languages.length ? args.languages.join(", ") : "Not provided"}`,
  ];

  if (args.role === "sales_agent" && args.agentData) {
    const a = args.agentData;
    lines.push(
      ``,
      `Agency: ${a.agencyName ?? "Not provided"}`,
      `REAA licence: ${a.reaaLicenceNumber ?? "Not provided"}`,
      `Years experience: ${a.yearsExperience ?? "Not provided"}`,
      `Website: ${a.websiteUrl ?? "Not provided"}`,
    );
  }

  if (args.role === "service_provider" && args.providerData) {
    const p = args.providerData;
    lines.push(
      ``,
      `Company: ${p.companyName ?? "Not provided"}`,
      `Discipline: ${p.discipline ?? "Not provided"}${p.otherDiscipline ? ` (${p.otherDiscipline})` : ""}`,
      `Contact: ${p.contactNumber ?? "Not provided"}`,
      `Primary language: ${p.primaryLanguage ?? "Not provided"}`,
      `City: ${p.addressCity ?? "Not provided"}`,
      `NZ Companies Register #: ${p.nzCompanyRegisterNumber ?? "Not provided"}`,
      `Certificate URL: ${p.incorporationCertUrl ?? "Not provided"}`,
      `Certificate review link: ${p.incorporationCertReviewUrl ?? "Not available"}`,
      ``,
      `Please review their Certificate of Incorporation and verify them:`,
      `UPDATE profiles SET is_verified = true WHERE id = '${args.profileId}';`,
    );
  }

  const body = lines.join("\n");
  return sendOwnerNotification(subject, body);
}
