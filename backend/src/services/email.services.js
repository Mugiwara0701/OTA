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
    const resetUrl = `${config.server.frontendUrl}/auth/reset-password?token=${resetToken}`;
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

module.exports = {
  sendBookingConfirmation,
  sendBookingCancellation,
  sendPaymentReceived,
  sendRefundInitiated,
  sendPasswordReset,
  sendEmailVerification,
  sendAirlineChangeAlert,
};
