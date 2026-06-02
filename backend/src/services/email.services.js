"use strict";

const { sendEmail } = require("../config/email.config");
const templates = require("../config/email-templates/index");
const logger = require("../config/logger");

// ── Helper: load user profile for email data ──────────────────────────────────
async function getUserEmailData(userId) {
  const { supabaseAdmin } = require("../config/supabase");
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("email, first_name")
    .eq("id", userId)
    .single();
  return user;
}

// ── Booking Confirmed ─────────────────────────────────────────────────────────
async function sendBookingConfirmation({
  userId,
  bookingRef,
  bookingType,
  amount,
  currency,
  details = {},
}) {
  try {
    const user = await getUserEmailData(userId);
    if (!user?.email) return;
    const tpl = templates.bookingConfirmed({
      bookingRef,
      bookingType,
      firstName: user.first_name,
      amount,
      currency,
      details,
    });
    await sendEmail({ to: user.email, ...tpl });
  } catch (err) {
    logger.error("[EmailService] bookingConfirmation failed", {
      err: err.message,
      userId,
      bookingRef,
    });
  }
}

// ── Booking Cancelled ─────────────────────────────────────────────────────────
async function sendBookingCancellation({
  userId,
  bookingRef,
  refundAmount = 0,
  currency,
}) {
  try {
    const user = await getUserEmailData(userId);
    if (!user?.email) return;
    const tpl = templates.bookingCancelled({
      bookingRef,
      firstName: user.first_name,
      refundAmount,
      currency,
    });
    await sendEmail({ to: user.email, ...tpl });
  } catch (err) {
    logger.error("[EmailService] bookingCancellation failed", {
      err: err.message,
      userId,
      bookingRef,
    });
  }
}

// ── Payment Received ──────────────────────────────────────────────────────────
async function sendPaymentReceived({ userId, bookingRef, amount, currency }) {
  try {
    const user = await getUserEmailData(userId);
    if (!user?.email) return;
    const tpl = templates.paymentReceived({
      bookingRef,
      firstName: user.first_name,
      amount,
      currency,
    });
    await sendEmail({ to: user.email, ...tpl });
  } catch (err) {
    logger.error("[EmailService] paymentReceived failed", {
      err: err.message,
      userId,
      bookingRef,
    });
  }
}

// ── Refund Initiated ──────────────────────────────────────────────────────────
async function sendRefundInitiated({
  userId,
  bookingRef,
  refundAmount,
  currency,
}) {
  try {
    const user = await getUserEmailData(userId);
    if (!user?.email) return;
    const tpl = templates.refundInitiated({
      bookingRef,
      firstName: user.first_name,
      refundAmount,
      currency,
    });
    await sendEmail({ to: user.email, ...tpl });
  } catch (err) {
    logger.error("[EmailService] refundInitiated failed", {
      err: err.message,
      userId,
      bookingRef,
    });
  }
}

// ── Password Reset ────────────────────────────────────────────────────────────
async function sendPasswordReset({ email, firstName, resetToken }) {
  try {
    const config = require("../config/app.config");
    // Use an https:// API URL — email clients block custom-scheme (otaapp://) links.
    // The backend GET handler will redirect to the deep link after receiving this request.
    const resetUrl = `${config.server.apiUrl}/auth/reset-password?token=${resetToken}`;
    const tpl = templates.passwordReset({ firstName, resetUrl });
    await sendEmail({ to: email, ...tpl });
  } catch (err) {
    logger.error("[EmailService] passwordReset failed", {
      err: err.message,
      email,
    });
  }
}

// ── Email Verification ────────────────────────────────────────────────────────
async function sendEmailVerification({ email, firstName, verifyToken }) {
  try {
    const config = require("../config/app.config");
    const verifyUrl = `${config.server.apiUrl}/auth/verify-email?token=${verifyToken}`;
    const tpl = templates.emailVerification({ firstName, verifyUrl });
    await sendEmail({ to: email, ...tpl });
  } catch (err) {
    logger.error("[EmailService] emailVerification failed", {
      err: err.message,
      email,
    });
  }
}

// ── Airline Change Alert ──────────────────────────────────────────────────────
async function sendAirlineChangeAlert({ userId, bookingRef, orderId }) {
  try {
    const user = await getUserEmailData(userId);
    if (!user?.email) return;
    const tpl = templates.airlineChangeAlert({
      firstName: user.first_name,
      bookingRef,
      orderId,
    });
    await sendEmail({ to: user.email, ...tpl });
  } catch (err) {
    logger.error("[EmailService] airlineChangeAlert failed", {
      err: err.message,
      userId,
      bookingRef,
    });
  }
}

// ── E-Ticket Email ────────────────────────────────────────────────────────────
async function sendETicketEmail({ userId, bookingRef, pdfBuffer }) {
  const { supabaseAdmin } = require("../config/supabase");
  const { sendEmail } = require("../config/email.config");
  const logger = require("../config/logger");

  try {
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("email, first_name")
      .eq("id", userId)
      .single();

    if (!user?.email) return;

    await sendEmail({
      to: user.email,
      subject: `Your E-Ticket – ${bookingRef}`,
      html: buildETicketEmailHtml({ firstName: user.first_name, bookingRef }),
      attachments: [
        {
          filename: `eticket-${bookingRef}.pdf`,
          content: pdfBuffer, // Buffer — Nodemailer accepts this directly
          contentType: "application/pdf",
        },
      ],
    });

    logger.info(
      `[EmailService] E-ticket sent for ${bookingRef} to ${user.email}`,
    );
  } catch (err) {
    logger.error("[EmailService] sendETicketEmail failed", {
      err: err.message,
      userId,
      bookingRef,
    });
  }
}

// ── Simple HTML body for the e-ticket email ───────────────────────────────────
function buildETicketEmailHtml({ firstName, bookingRef }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <style>
    body { margin:0; padding:0; background:#0D0B1E; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
    * { box-sizing:border-box; }
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0B1E;min-height:100vh;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="100%" style="max-width:580px;border-radius:20px;overflow:hidden;border:1px solid #2D2850;">
 
        <tr><td>
          <div style="background:linear-gradient(135deg,#6C3CE1,#9B5CFF);padding:40px 32px 32px;text-align:center;">
            <div style="font-size:48px;margin-bottom:12px;line-height:1;">🎫</div>
            <h1 style="margin:0 0 8px;color:#fff;font-size:24px;font-weight:800;">Your E-Ticket is Ready!</h1>
            <p style="margin:0;color:rgba(255,255,255,0.8);font-size:15px;">Find it attached to this email</p>
          </div>
        </td></tr>
 
        <tr><td style="background:#0D0B1E;padding:28px 32px;">
          <p style="margin:0 0 16px;color:#FFFFFF;font-size:16px;">Hi <strong>${firstName}</strong> 👋</p>
          <p style="margin:0 0 20px;color:#A0A0C0;font-size:14px;line-height:1.7;">
            Your e-ticket for booking <strong style="color:#9B5CFF;">${bookingRef}</strong> is attached as a PDF.
            Please save it to your device and present it at the airport check-in counter along with a valid photo ID.
          </p>
 
          <div style="background:#1A1730;border-radius:12px;padding:16px;border:1px solid #2D2850;margin-bottom:20px;">
            <p style="margin:0 0 8px;color:#A0A0C0;font-size:13px;font-weight:600;">What to bring to the airport:</p>
            <ul style="margin:0;padding-left:18px;color:#A0A0C0;font-size:13px;line-height:2;">
              <li>This e-ticket (printed or on your phone)</li>
              <li>Valid passport or government-issued photo ID</li>
              <li>Any required travel visas</li>
            </ul>
          </div>
 
          <div style="background:#6C3CE122;border-left:3px solid #6C3CE1;border-radius:8px;padding:14px 16px;">
            <p style="margin:0;color:#FFFFFF;font-size:14px;line-height:1.6;">
              ℹ️&nbsp; Manage your trip any time in the Wanderly app.
            </p>
          </div>
        </td></tr>
 
        <tr><td style="background:#1A1730;padding:24px 32px;text-align:center;border-top:1px solid #2D2850;">
          <div style="font-size:20px;font-weight:800;background:linear-gradient(135deg,#6C3CE1,#9B5CFF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px;">✈ Wanderly</div>
          <p style="margin:0;color:#6B6B8E;font-size:12px;line-height:1.6;">
            This is an automated message — please do not reply.<br/>
            © ${new Date().getFullYear()} Wanderly. All rights reserved.
          </p>
        </td></tr>
 
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = {
  sendBookingConfirmation,
  sendBookingCancellation,
  sendPaymentReceived,
  sendRefundInitiated,
  sendPasswordReset,
  sendEmailVerification,
  sendAirlineChangeAlert,
  sendETicketEmail,
};
