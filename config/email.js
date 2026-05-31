const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "DWS Academy <no-reply@ternkonnect.com>";
const BRAND_NAME = "DWS Academy";
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const NAMED_EMAIL_PATTERN = /^.+\s<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function isResendTestingRestriction(message = "") {
  return message.includes("You can only send testing emails to your own email address");
}

function getFromAddress() {
  const value = process.env.EMAIL_FROM?.trim();
  if (!value) return DEFAULT_FROM;
  if (EMAIL_PATTERN.test(value) || NAMED_EMAIL_PATTERN.test(value)) return value;

  const looseMatch = value.match(/^(.*)\s+([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/);
  if (looseMatch) {
    return `${looseMatch[1].trim()} <${looseMatch[2]}>`;
  }

  return value;
}

export async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getFromAddress(),
      to: [to],
      subject,
      html,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || "Failed to send email";

    if (!isProduction() && isResendTestingRestriction(message)) {
      console.warn(
        `Email not sent to ${to} because Resend is in testing mode. Subject: ${subject}`,
      );
      return { skipped: true, reason: "resend_testing_mode" };
    }

    if (isResendTestingRestriction(message)) {
      throw new Error(
        "Email delivery is not configured for public recipients. Verify a domain in Resend and set EMAIL_FROM to an address on that domain.",
      );
    }

    throw new Error(message);
  }

  return data;
}

export function appUrl(path = "") {
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:8080";
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emailLayout({
  preview,
  eyebrow,
  title,
  body,
  action,
  secondary,
  footerNote,
}) {
  const currentYear = new Date().getFullYear();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e4e4e7;border-radius:18px;overflow:hidden;box-shadow:0 16px 40px rgba(24,24,27,0.08);">
            <tr>
              <td style="background:#111111;padding:28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <div style="display:inline-block;width:44px;height:44px;border-radius:12px;background:#facc15;text-align:center;line-height:44px;font-weight:800;font-size:18px;color:#111111;">D</div>
                    </td>
                    <td align="right" style="font-size:14px;font-weight:700;color:#facc15;letter-spacing:0.02em;">${BRAND_NAME}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 32px 12px;">
                <p style="margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#ca8a04;">${escapeHtml(eyebrow)}</p>
                <h1 style="margin:0;font-size:28px;line-height:1.2;color:#111111;">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px;font-size:16px;line-height:1.7;color:#3f3f46;">
                ${body}
              </td>
            </tr>
            ${action
      ? `<tr>
              <td style="padding:0 32px 28px;">
                <a href="${action.href}" style="display:inline-block;background:#facc15;color:#111111;text-decoration:none;font-weight:800;font-size:15px;padding:14px 22px;border-radius:10px;">${escapeHtml(action.label)}</a>
              </td>
            </tr>`
      : ""
    }
            ${secondary
      ? `<tr>
              <td style="padding:0 32px 28px;">
                <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;padding:16px;">
                  ${secondary}
                </div>
              </td>
            </tr>`
      : ""
    }
            <tr>
              <td style="padding:22px 32px;background:#fafafa;border-top:1px solid #e4e4e7;">
                <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#71717a;">${escapeHtml(footerNote || "If you did not request this email, you can safely ignore it.")}</p>
                <p style="margin:0;font-size:12px;color:#a1a1aa;">Copyright ${currentYear} ${BRAND_NAME}. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function verificationEmailTemplate({ name, link }) {
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(link);

  return emailLayout({
    preview: "Verify your email address to activate your DWS Academy account.",
    eyebrow: "Account verification",
    title: "Confirm your email address",
    body: `
      <p style="margin:0 0 16px;">Hello ${safeName},</p>
      <p style="margin:0 0 16px;">Welcome to DWS Academy. Please verify your email address so we can activate your account and keep your learning profile secure.</p>
      <p style="margin:0;">This verification link expires in 24 hours.</p>
    `,
    action: {
      href: safeLink,
      label: "Verify Email Address",
    },
    secondary: `
      <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#71717a;">Button not working? Copy and paste this secure link into your browser:</p>
      <p style="margin:0;word-break:break-all;font-size:13px;line-height:1.6;color:#3f3f46;">${safeLink}</p>
    `,
    footerNote:
      "If you did not create a DWS Academy account, you can safely ignore this email.",
  });
}

export function passwordResetEmailTemplate({ name, otp }) {
  const safeName = escapeHtml(name);
  const safeOtp = escapeHtml(otp);

  return emailLayout({
    preview: "Use your DWS Academy reset code to create a new password.",
    eyebrow: "Password reset",
    title: "Reset your password",
    body: `
      <p style="margin:0 0 16px;">Hello ${safeName},</p>
      <p style="margin:0 0 16px;">We received a request to reset the password for your DWS Academy account. Enter the code below on the reset password page.</p>
      <p style="margin:0;">This code expires in 10 minutes.</p>
    `,
    secondary: `
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.08em;">Your reset code</p>
      <p style="margin:0;font-size:34px;line-height:1.2;font-weight:800;letter-spacing:8px;color:#111111;">${safeOtp}</p>
    `,
    footerNote:
      "If you did not request a password reset, your password is unchanged and you can ignore this email.",
  });
}

export function adminInviteEmailTemplate({ name, inviterName, link }) {
  const safeName = escapeHtml(name);
  const safeInviterName = escapeHtml(inviterName || "A super admin");
  const safeLink = escapeHtml(link);

  return emailLayout({
    preview:
      "You have been invited to join DWS Academy as an administrator.",
    eyebrow: "Admin invitation",
    title: "You are invited to become an admin",
    body: `
      <p style="margin:0 0 16px;">Hello ${safeName},</p>
      <p style="margin:0 0 16px;">${safeInviterName} has invited you to join DWS Academy as an administrator. Once your password is created, you will be able to manage courses and support learners from the admin dashboard.</p>
      <p style="margin:0;">For your security, this invitation expires in 7 days.</p>
    `,
    action: {
      href: safeLink,
      label: "Create Admin Password",
    },
    secondary: `
      <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#71717a;">Button not working? Copy and paste this secure invitation link into your browser:</p>
      <p style="margin:0;word-break:break-all;font-size:13px;line-height:1.6;color:#3f3f46;">${safeLink}</p>
    `,
    footerNote:
      "If you were not expecting this invitation, you can safely ignore this email.",
  });
}
