"use strict";

// ── Shared Design System ──────────────────────────────────────────────────────
const colors = {
  bg: "#0D0B1E",
  card: "#1A1730",
  cardBorder: "#2D2850",
  gradientStart: "#6C3CE1",
  gradientEnd: "#9B5CFF",
  text: "#FFFFFF",
  textSecondary: "#A0A0C0",
  textMuted: "#6B6B8E",
  success: "#4CAF50",
  error: "#E53935",
  warning: "#FF8C00",
  divider: "#2D2850",
};

const baseStyles = `
  body { margin:0; padding:0; background-color:${colors.bg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  * { box-sizing:border-box; }
`;

// ── Shared Components ─────────────────────────────────────────────────────────

function header(iconEmoji, title, subtitle = "") {
  return `
    <div style="background:linear-gradient(135deg,${colors.gradientStart},${colors.gradientEnd});padding:40px 32px 32px;text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;line-height:1;">${iconEmoji}</div>
      <h1 style="margin:0 0 8px;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">${title}</h1>
      ${subtitle ? `<p style="margin:0;color:rgba(255,255,255,0.8);font-size:15px;">${subtitle}</p>` : ""}
    </div>`;
}

function infoRow(label, value, highlight = false) {
  return `
    <tr>
      <td style="padding:12px 16px;color:${colors.textSecondary};font-size:13px;font-weight:500;width:40%;border-bottom:1px solid ${colors.divider};">${label}</td>
      <td style="padding:12px 16px;color:${highlight ? colors.gradientEnd : colors.text};font-size:14px;font-weight:${highlight ? "700" : "500"};border-bottom:1px solid ${colors.divider};">${value}</td>
    </tr>`;
}

function ctaButton(text, url, color = colors.gradientStart) {
  return `
    <div style="text-align:center;margin:28px 0;">
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,${colors.gradientStart},${colors.gradientEnd});color:#fff;text-decoration:none;padding:14px 36px;border-radius:50px;font-size:15px;font-weight:700;letter-spacing:0.3px;">
        ${text}
      </a>
    </div>`;
}

function pill(text, color = colors.gradientStart) {
  return `<span style="display:inline-block;background:${color}22;color:${color};border:1px solid ${color}44;padding:3px 12px;border-radius:50px;font-size:12px;font-weight:600;">${text}</span>`;
}

function wrapper(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <style>${baseStyles}</style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${colors.bg};min-height:100vh;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="100%" style="max-width:580px;border-radius:20px;overflow:hidden;border:1px solid ${colors.cardBorder};">

        ${content}

        <!-- Footer -->
        <tr><td style="background:${colors.card};padding:24px 32px;text-align:center;border-top:1px solid ${colors.divider};">
          <div style="font-size:20px;font-weight:800;background:linear-gradient(135deg,${colors.gradientStart},${colors.gradientEnd});-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px;">✈ Wanderly</div>
          <p style="margin:0;color:${colors.textMuted};font-size:12px;line-height:1.6;">This is an automated message — please do not reply.<br/>© ${new Date().getFullYear()} Wanderly. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function bodyCard(content) {
  return `
    <tr><td style="background:${colors.bg};padding:28px 32px;">
      ${content}
    </td></tr>`;
}

function infoTable(rows) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${colors.card};border-radius:12px;overflow:hidden;border:1px solid ${colors.cardBorder};margin:20px 0;">
      ${rows}
    </table>`;
}

function greeting(firstName) {
  return `<p style="margin:0 0 16px;color:${colors.text};font-size:16px;">Hi <strong>${firstName}</strong> 👋</p>`;
}

function bodyText(text) {
  return `<p style="margin:0 0 16px;color:${colors.textSecondary};font-size:14px;line-height:1.7;">${text}</p>`;
}

function alertBox(text, type = "info") {
  const map = {
    info:    { bg: "#6C3CE122", border: colors.gradientStart, icon: "ℹ️" },
    success: { bg: "#4CAF5022", border: colors.success,       icon: "✅" },
    warning: { bg: "#FF8C0022", border: colors.warning,       icon: "⚠️" },
    error:   { bg: "#E5393522", border: colors.error,         icon: "❌" },
  };
  const s = map[type] || map.info;
  return `
    <div style="background:${s.bg};border-left:3px solid ${s.border};border-radius:8px;padding:14px 16px;margin:16px 0;">
      <p style="margin:0;color:${colors.text};font-size:14px;line-height:1.6;">${s.icon}&nbsp; ${text}</p>
    </div>`;
}


// ── 1. Booking Confirmed ──────────────────────────────────────────────────────
function bookingConfirmed({ bookingRef, bookingType, firstName, amount, currency, details = {} }) {
  const typeLabel = bookingType?.charAt(0).toUpperCase() + bookingType?.slice(1).toLowerCase();
  const typeIcon = bookingType === "FLIGHT" ? "✈️" : bookingType === "HOTEL" ? "🏨" : "🚗";

  const rows = [
    infoRow("Booking Reference", bookingRef, true),
    infoRow("Type", `${typeIcon} ${typeLabel}`),
    infoRow("Total Paid", `${amount} ${currency}`, true),
    details.origin     ? infoRow("Route",     `${details.origin} → ${details.destination}`) : "",
    details.departureAt? infoRow("Departure", new Date(details.departureAt).toLocaleString()) : "",
    details.pnr        ? infoRow("PNR / Ref", details.pnr, true) : "",
    details.hotelName  ? infoRow("Property",  details.hotelName) : "",
    details.checkIn    ? infoRow("Check-in",  details.checkIn) : "",
    details.checkOut   ? infoRow("Check-out", details.checkOut) : "",
  ].join("");

  return {
    subject: `Booking confirmed ✓ — ${bookingRef}`,
    html: wrapper(`
      ${header("🎉", "Booking Confirmed!", `Your ${typeLabel} is all set`)}
      ${bodyCard(`
        ${greeting(firstName)}
        ${bodyText(`Your booking has been confirmed. Here's everything you need to know:`)}
        ${infoTable(rows)}
        ${alertBox("Keep your booking reference handy — you'll need it to manage your trip.", "info")}
        <p style="margin:16px 0 0;color:${colors.textMuted};font-size:12px;text-align:center;">Questions? Manage your booking in the Wanderly app.</p>
      `)}
    `),
  };
}


// ── 2. Booking Cancelled ──────────────────────────────────────────────────────
function bookingCancelled({ bookingRef, firstName, refundAmount, currency }) {
  return {
    subject: `Booking cancelled — ${bookingRef}`,
    html: wrapper(`
      ${header("❌", "Booking Cancelled", `Reference: ${bookingRef}`)}
      ${bodyCard(`
        ${greeting(firstName)}
        ${bodyText(`Your booking <strong style="color:${colors.text};">${bookingRef}</strong> has been successfully cancelled.`)}
        ${infoTable(`
          ${infoRow("Booking Reference", bookingRef)}
          ${infoRow("Status", `<span style="color:${colors.error};font-weight:700;">Cancelled</span>`)}
          ${infoRow("Refund", refundAmount > 0 ? `${refundAmount} ${currency}` : "No refund applicable", refundAmount > 0)}
        `)}
        ${refundAmount > 0
          ? alertBox(`A refund of <strong>${refundAmount} ${currency}</strong> has been initiated. It will appear in your account within 5–10 business days.`, "success")
          : alertBox("No refund is applicable for this cancellation per our policy.", "warning")
        }
      `)}
    `),
  };
}


// ── 3. Payment Received ───────────────────────────────────────────────────────
function paymentReceived({ bookingRef, firstName, amount, currency }) {
  return {
    subject: `Payment received ✓ — ${bookingRef}`,
    html: wrapper(`
      ${header("💳", "Payment Received!", "Your payment was processed successfully")}
      ${bodyCard(`
        ${greeting(firstName)}
        ${bodyText("We've received your payment and your booking is being confirmed. You'll receive a confirmation email shortly.")}
        ${infoTable(`
          ${infoRow("Booking Reference", bookingRef, true)}
          ${infoRow("Amount Paid", `${amount} ${currency}`, true)}
          ${infoRow("Status", `<span style="color:${colors.success};font-weight:700;">✓ Payment Successful</span>`)}
        `)}
        ${alertBox("Your booking confirmation will arrive in a separate email within a few minutes.", "info")}
      `)}
    `),
  };
}


// ── 4. Refund Initiated ───────────────────────────────────────────────────────
function refundInitiated({ bookingRef, firstName, refundAmount, currency }) {
  return {
    subject: `Refund initiated — ${bookingRef}`,
    html: wrapper(`
      ${header("💸", "Refund Initiated", "Your money is on its way back")}
      ${bodyCard(`
        ${greeting(firstName)}
        ${bodyText("We've initiated a refund for your cancelled booking. Here are the details:")}
        ${infoTable(`
          ${infoRow("Booking Reference", bookingRef)}
          ${infoRow("Refund Amount", `${refundAmount} ${currency}`, true)}
          ${infoRow("Processing Time", "5–10 business days")}
          ${infoRow("Status", `<span style="color:${colors.warning};font-weight:700;">⏳ Processing</span>`)}
        `)}
        ${alertBox("Refund timelines depend on your bank or card issuer. If you don't see it after 10 business days, please contact support.", "info")}
      `)}
    `),
  };
}


// ── 5. Password Reset ─────────────────────────────────────────────────────────
function passwordReset({ firstName, resetUrl, expiresInMinutes = 30 }) {
  return {
    subject: "Reset your Wanderly password",
    html: wrapper(`
      ${header("🔐", "Reset Your Password", "We received a password reset request")}
      ${bodyCard(`
        ${greeting(firstName)}
        ${bodyText("No worries — it happens! Click the button below to set a new password for your Wanderly account.")}
        ${ctaButton("Reset Password →", resetUrl)}
        ${alertBox(`This link expires in <strong>${expiresInMinutes} minutes</strong>. If you didn't request this, you can safely ignore this email — your password won't change.`, "warning")}
        <div style="background:${colors.card};border-radius:10px;padding:14px 16px;margin:16px 0;border:1px solid ${colors.cardBorder};">
          <p style="margin:0 0 6px;color:${colors.textMuted};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Or copy this URL into your browser</p>
          <p style="margin:0;color:${colors.textSecondary};font-size:12px;word-break:break-all;">${resetUrl}</p>
        </div>
      `)}
    `),
  };
}


// ── 6. Email Verification ─────────────────────────────────────────────────────
function emailVerification({ firstName, verifyUrl }) {
  return {
    subject: "Verify your Wanderly account ✈️",
    html: wrapper(`
      ${header("✈️", "Welcome to Wanderly!", "One last step to get started")}
      ${bodyCard(`
        ${greeting(firstName)}
        ${bodyText("Thanks for signing up! Please verify your email address to activate your account and start exploring the world.")}

        <!-- Feature highlights -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
          <tr>
            <td style="padding:4px 8px 4px 0;width:33%;vertical-align:top;">
              <div style="background:${colors.card};border-radius:10px;padding:14px;text-align:center;border:1px solid ${colors.cardBorder};">
                <div style="font-size:22px;margin-bottom:6px;">✈️</div>
                <p style="margin:0;color:${colors.text};font-size:12px;font-weight:600;">Flights</p>
              </div>
            </td>
            <td style="padding:4px 4px;width:33%;vertical-align:top;">
              <div style="background:${colors.card};border-radius:10px;padding:14px;text-align:center;border:1px solid ${colors.cardBorder};">
                <div style="font-size:22px;margin-bottom:6px;">🏨</div>
                <p style="margin:0;color:${colors.text};font-size:12px;font-weight:600;">Hotels</p>
              </div>
            </td>
            <td style="padding:4px 0 4px 8px;width:33%;vertical-align:top;">
              <div style="background:${colors.card};border-radius:10px;padding:14px;text-align:center;border:1px solid ${colors.cardBorder};">
                <div style="font-size:22px;margin-bottom:6px;">🚗</div>
                <p style="margin:0;color:${colors.text};font-size:12px;font-weight:600;">Cars</p>
              </div>
            </td>
          </tr>
        </table>

        ${ctaButton("Verify My Email →", verifyUrl)}
        ${alertBox("If you didn't create a Wanderly account, you can safely ignore this email.", "info")}
      `)}
    `),
  };
}


// ── 7. Airline Change Alert ───────────────────────────────────────────────────
function airlineChangeAlert({ firstName, bookingRef, orderId }) {
  const reviewUrl = `${process.env.FRONTEND_URL}/bookings/${orderId}`;
  return {
    subject: `⚠️ Action required: Schedule change on ${bookingRef}`,
    html: wrapper(`
      ${header("⚠️", "Schedule Change Notice", "Your flight itinerary has been updated")}
      ${bodyCard(`
        ${greeting(firstName)}
        ${bodyText(`The airline has made a change to your booking <strong style="color:${colors.text};">${bookingRef}</strong>. Please review the change and take action as soon as possible.`)}
        ${infoTable(`
          ${infoRow("Booking Reference", bookingRef, true)}
          ${infoRow("Status", `<span style="color:${colors.warning};font-weight:700;">⚠️ Action Required</span>`)}
        `)}
        ${alertBox("Airline-initiated changes may affect your departure time, route, or aircraft. Please review and accept the new itinerary or request an alternative.", "warning")}
        ${ctaButton("Review Change →", reviewUrl, colors.error)}
        ${bodyText(`<span style="font-size:13px;">If you have questions, contact our support team through the Wanderly app.</span>`)}
      `)}
    `),
  };
}


module.exports = {
  bookingConfirmed,
  bookingCancelled,
  paymentReceived,
  refundInitiated,
  passwordReset,
  emailVerification,
  airlineChangeAlert,
};
