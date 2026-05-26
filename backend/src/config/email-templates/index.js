"use strict";

// ── Booking Confirmed ─────────────────────────────────────────────────────────
function bookingConfirmed({
  bookingRef,
  bookingType,
  firstName,
  amount,
  currency,
  details = {},
}) {
  const typeLabel =
    bookingType?.charAt(0) + bookingType?.slice(1).toLowerCase();
  return {
    subject: `Your ${typeLabel} booking is confirmed — ${bookingRef}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a1a1a">Booking Confirmed ✓</h2>
        <p>Hi ${firstName},</p>
        <p>Your <strong>${typeLabel}</strong> booking <strong>${bookingRef}</strong> has been confirmed.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #eee;color:#666">Booking Reference</td><td style="padding:8px;border:1px solid #eee"><strong>${bookingRef}</strong></td></tr>
          <tr><td style="padding:8px;border:1px solid #eee;color:#666">Total Paid</td><td style="padding:8px;border:1px solid #eee"><strong>${amount} ${currency}</strong></td></tr>
          ${details.origin ? `<tr><td style="padding:8px;border:1px solid #eee;color:#666">Route</td><td style="padding:8px;border:1px solid #eee">${details.origin} → ${details.destination}</td></tr>` : ""}
          ${details.departureAt ? `<tr><td style="padding:8px;border:1px solid #eee;color:#666">Departure</td><td style="padding:8px;border:1px solid #eee">${new Date(details.departureAt).toLocaleString()}</td></tr>` : ""}
          ${details.pnr ? `<tr><td style="padding:8px;border:1px solid #eee;color:#666">PNR / Ref</td><td style="padding:8px;border:1px solid #eee"><strong>${details.pnr}</strong></td></tr>` : ""}
          ${details.hotelName ? `<tr><td style="padding:8px;border:1px solid #eee;color:#666">Property</td><td style="padding:8px;border:1px solid #eee">${details.hotelName}</td></tr>` : ""}
          ${details.checkIn ? `<tr><td style="padding:8px;border:1px solid #eee;color:#666">Check-in</td><td style="padding:8px;border:1px solid #eee">${details.checkIn}</td></tr>` : ""}
          ${details.checkOut ? `<tr><td style="padding:8px;border:1px solid #eee;color:#666">Check-out</td><td style="padding:8px;border:1px solid #eee">${details.checkOut}</td></tr>` : ""}
        </table>
        <p style="color:#666;font-size:14px">You can manage your booking in your account dashboard. Keep your booking reference handy.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">This is an automated email — please do not reply.</p>
      </div>`,
  };
}

// ── Booking Cancelled ─────────────────────────────────────────────────────────
function bookingCancelled({ bookingRef, firstName, refundAmount, currency }) {
  return {
    subject: `Booking cancelled — ${bookingRef}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a1a1a">Booking Cancelled</h2>
        <p>Hi ${firstName},</p>
        <p>Your booking <strong>${bookingRef}</strong> has been successfully cancelled.</p>
        ${
          refundAmount > 0
            ? `<p>A refund of <strong>${refundAmount} ${currency}</strong> has been initiated and will appear in your account within 5–10 business days.</p>`
            : "<p>No refund is applicable for this cancellation.</p>"
        }
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">This is an automated email — please do not reply.</p>
      </div>`,
  };
}

// ── Payment Received ──────────────────────────────────────────────────────────
function paymentReceived({ bookingRef, firstName, amount, currency }) {
  return {
    subject: `Payment received — ${bookingRef}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a1a1a">Payment Received ✓</h2>
        <p>Hi ${firstName},</p>
        <p>We've received your payment of <strong>${amount} ${currency}</strong> for booking <strong>${bookingRef}</strong>.</p>
        <p>Your booking is now being confirmed. You'll receive a separate confirmation email shortly.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">This is an automated email — please do not reply.</p>
      </div>`,
  };
}

// ── Refund Initiated ──────────────────────────────────────────────────────────
function refundInitiated({ bookingRef, firstName, refundAmount, currency }) {
  return {
    subject: `Refund initiated — ${bookingRef}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a1a1a">Refund Initiated</h2>
        <p>Hi ${firstName},</p>
        <p>A refund of <strong>${refundAmount} ${currency}</strong> for booking <strong>${bookingRef}</strong> has been initiated.</p>
        <p>Refunds typically appear within 5–10 business days depending on your bank.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">This is an automated email — please do not reply.</p>
      </div>`,
  };
}

// ── Password Reset ────────────────────────────────────────────────────────────
function passwordReset({ firstName, resetUrl, expiresInMinutes = 30 }) {
  return {
    subject: "Reset your password",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a1a1a">Reset Your Password</h2>
        <p>Hi ${firstName},</p>
        <p>We received a request to reset your password. Click the button below to set a new one.</p>
        <p style="margin:24px 0">
          <a href="${resetUrl}" style="background:#1a1a1a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">Reset Password</a>
        </p>
        <p style="color:#666;font-size:14px">This link expires in ${expiresInMinutes} minutes. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">If the button doesn't work, copy this URL into your browser: <br/>${resetUrl}</p>
      </div>`,
  };
}

// ── Email Verification ────────────────────────────────────────────────────────
function emailVerification({ firstName, verifyUrl }) {
  return {
    subject: "Verify your email address",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1a1a1a">Verify Your Email</h2>
        <p>Hi ${firstName}, welcome aboard!</p>
        <p>Please verify your email address to activate your account.</p>
        <p style="margin:24px 0">
          <a href="${verifyUrl}" style="background:#1a1a1a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">Verify Email</a>
        </p>
        <p style="color:#666;font-size:14px">If you didn't create an account, you can ignore this email.</p>
      </div>`,
  };
}

// ── Airline-Initiated Change Alert ────────────────────────────────────────────
function airlineChangeAlert({ firstName, bookingRef, orderId }) {
  return {
    subject: `Action required: Schedule change on booking ${bookingRef}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#c0392b">Schedule Change Notice</h2>
        <p>Hi ${firstName},</p>
        <p>The airline has made a change to your booking <strong>${bookingRef}</strong>.</p>
        <p>Please log in to your account to review the change and accept or request a new flight.</p>
        <p style="margin:24px 0">
          <a href="${process.env.FRONTEND_URL}/bookings/${orderId}" style="background:#c0392b;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">Review Change</a>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">This is an automated email — please do not reply.</p>
      </div>`,
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
