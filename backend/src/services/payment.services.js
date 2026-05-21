"use strict";

const { supabaseAdmin } = require("../config/supabase");
const { provider, client } = require("../config/payment");
const config = require("../config/app.config");
const logger = require("../config/logger");
const { AppError } = require("../utils/AppError");
const {
  BOOKINGS,
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  HTTP,
  ACTIVITY_LOGS,
} = require("../constants/index");
const { PaymentIntents } = require("@duffel/api/DuffelPayments");

// ── INITIATE PAYMENT  ─────────────────────────────────────────────────────────────
async function initiatePayment({ bookingId, userId }) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();
  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.status !== BOOKINGS.PENDING_PAYMENT) {
    throw new AppError(
      `Cannot initiate payment for booking with status: ${booking.status}`,
      HTTP.UNPROCESSABLE,
    );
  }
  const { data: existingPayment } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("booking_id", bookingId)
    .single();
  if (existingPayment && existingPayment.status === PAYMENT_STATUS.COMPLETED) {
    throw new AppError(
      "Payment already completed for this booking",
      HTTP.CONFLICT,
    );
  }

  await supabaseAdmin
    .from("bookings")
    .update({ status: BOOKINGS.PAYMENT_PROCESSING })
    .eq("id", bookingId);

  let paymentRecord = {};
  let clientResponse = {};

  // FOR DEVELOPMENT AND TESTING DURING DEVELOPMENT
  if (provider === PAYMENT_PROVIDER.STRIPE) {
    const session = await client.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: booking.currency.toLowerCase(),
            unit_amount: Math.round(parseFloat(booking.total_amount) * 100),
            product_data: {
              name: `OTA Booking: ${booking.booking_ref}`,
              description: `${booking.booking_type} booking`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${config.server.frontendUrl}/booking/success?bookingId=${bookingId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.server.frontendUrl}/booking/cancel?bookingId=${bookingId}`,
      metadata: { bookingId, userId, bookingRef: booking.booking_ref },
    });
    paymentRecord = {
      booking_id: bookingId,
      user_id: userId,
      stripe_session_id: session.id,
      amount: parseFloat(booking.total_amount),
      currency: booking.currency,
      status: PAYMENT_STATUS.PENDING,
      payment_provider: PAYMENT_PROVIDER.STRIPE,
    };

    clientResponse = {
      provider: "stripe",
      sessionId: session.id,
      sessionUrl: session.url,
      publishableKey: config.payment.stripe.publishableKey,
    };
  } else {
    const intent = await client.payments.intents.create({
      amount: String(Math.round(parseFloat(booking.total_amount) * 100)),
    });

    paymentRecord = {
      booking_id: bookingId,
      user_id: userId,
      duffel_payment_intent_id: intent.id,
      duffel_client_key: intent.client_key,
      amount: parseFloat(booking.total_amount),
      currency: booking.currency,
      status: PAYMENT_STATUS.PENDING,
      payment_provider: PAYMENT_PROVIDER.DUFFEL,
    };

    clientResponse = {
      provider: "duffel",
      PaymentIntentId: intent.id,
      clientKey: intent.client_key,
    };
  }

  const { error: paymentError } = await supabaseAdmin
    .from("payments")
    .upsert(paymentRecord, { onConflict: "booking_id" });

  if (paymentError) {
    await supabaseAdmin
      .from("bookings")
      .update({ status: BOOKINGS.PENDING_PAYMENT })
      .eq("id", bookingId);
    throw new AppError(
      "Failed to create payment record",
      HTTP.INTERNAL_ERROR,
      paymentError,
    );
  }

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.PAYMENT_INITIALIZED,
    old_status: BOOKINGS.PENDING_PAYMENT,
    new_status: BOOKINGS.PAYMENT_PROCESSING,
    meta_data: { provider, bookingRef: booking.booking_ref },
    performed_by: userId,
  });

  logger.info(
    `[PaymentService] Payment initiated for ${booking.booking_ref} via ${provider}`,
  );
  return clientResponse;
}

// ── CONFIRM PAYMENT (CALLED AFTER FRONTEND CONFIRM PAYMENTS) ─────────────────────────────────────────────────────────────
async function confirmPayment({
  bookingId,
  sessionId,
  PaymentIntentId,
  userId,
}) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);

  let stripeVerified = false;

  if (provider === PAYMENT_PROVIDER.STRIPE && sessionId) {
    const session = await client.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      throw new AppError(
        "Payment not completed by the Stripe",
        HTTP.UNPROCESSABLE,
      );
    }
    stripeVerified = true;
    await supabaseAdmin
      .from("payments")
      .update({
        stripe_payment_intent_id: session.payment_intent,
        status: PAYMENT_STATUS.COMPLETED,
        paid_at: new Date().toISOString(),
      })
      .eq("booking_id", bookingId);
  } else {
    await supabaseAdmin
      .from("payments")
      .update({
        status: PAYMENT_STATUS.COMPLETED,
        paid_at: new Date().toISOString(),
      })
      .eq("booking_id", bookingId);
  }

  await _confirmPRoviderBooking(booking, provider);

  await supabaseAdmin
    .from("bookings")
    .update({ status: BOOKINGS.CONFIRMED })
    .eq("id", bookingId);

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.PAYMENT_COMPLETED,
    old_status: booking.status,
    new_status: BOOKINGS.CONFIRMED,
    meta_data: { provider, stripeVerified },
    performed_by: userId || "system",
  });

  logger.info(
    `[PaymentService] Payment confirmed for booking: ${booking.booking_Ref}`,
  );

  return {
    bookingId,
    bookingRef: booking.booking_ref,
    status: BOOKINGS.CONFIRMED,
  };
}

// ── INTERNAL: CONFIRM DUFFEL ORDER AFTER PAYMENT ─────────────────────────────────────────────────────────────
async function confirmProviderBooking(booking, paymentProvider) {
  const { BOOKING_TYPE } = require("../constants/index");

  if (booking.booking_type === BOOKING_TYPE.FLIGHT) {
    const flightService = require("./flight.services");
    await flightService.confirmFlightBooking({
      bookingId: booking.id,
      userId: booking.user_id,
      paymentProvider,
    });
  }
  // Stays and Cars are confirmed on Duffel via their own confirm methods
  // which are called explicitly by their respective controllers
}

// ── FAIL PAYMENT ─────────────────────────────────────────────────────────────
async function failPayment({ bookingId, reason = "Payment failed" }) {
  await supabaseAdmin
    .from("payments")
    .update({ status: PAYMENT_STATUS.FAILED })
    .eq("booking_id", bookingId);

  await supabaseAdmin
    .from("bookings")
    .update({ status: BOOKINGS.FAILED })
    .eq("id", bookingId);

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: "PAYMENT_FAILED",
    new_status: BOOKINGS.FAILED,
    message: reason,
  });

  logger.warn(`[PaymentService] Payment failed for booking: ${bookingId}`, {
    reason,
  });
}
// ── INITIATE REFUND ─────────────────────────────────────────────────────────────
async function initiateRefund({
  bookingId,
  userId,
  reason = "Customer requested refund",
  amount,
}) {
  const { data: payment, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("booking_id", bookingId)
    .single();
  if (error || !payment)
    throw new AppError("Payment record not found", HTTP.NOT_FOUND);
  if (payment.status !== PAYMENT_STATUS.COMPLETED) {
    throw new AppError(
      "Only completed payments can be refunded",
      HTTP.UNPROCESSABLE,
    );
  }

  const refundAmount = amount || payment.amount;

  await supabaseAdmin
    .from("bookings")
    .update({ status: BOOKINGS.REFUND_PROCESSING })
    .eq("id", bookingId);

  let refundRecord = {
    booking_id: bookingId,
    payment_id: payment.id,
    amount: refundAmount,
    currency: payment.currency,
    reason,
    status: "PROCESSING",
    requested_by: userId,
    payment_provider: payment.payment_provider,
  };
  if (
    payment.payment_provider === PAYMENT_PROVIDER.STRIPE &&
    payment.stripe_payment_intent_id
  ) {
    const refund = await client.refunds.create({
      payment_intent: payment.stripe_payment_intent_id,
      amount: Math.round(refundAmount * 100),
    });
    refundRecord.stripe_refund_id = refund.id;
    refundRecord.status = "COMPLETED";

    await supabaseAdmin
      .from("payments")
      .update({ status: BOOKINGS.REFUNDED })
      .eq("id", payment.id);

    await supabaseAdmin
      .from("bookings")
      .update({ status: BOOKINGS.REFUNDED })
      .eq("id", bookingId);
  }
  const { error: refundError } = await supabaseAdmin
    .from("refunds")
    .insert(refundRecord);
  if (refundError)
    throw new AppError(
      "Failed to record refund",
      HTTP.INTERNAL_ERROR,
      refundError,
    );

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.REFUND_REQUESTED,
    message: reason,
    meta_data: { refundAmount, provider: payment.payment_provider },
    performed_by: userId,
  });

  logger.info(`[PaymentService] Refund initiated for booking: ${bookingId}`);

  return {
    bookingId,
    refundAmount,
    currency: payment.currency,
    status: refundRecord.status,
  };
}

// ── GET PAYMENT STATUS ─────────────────────────────────────────────────────────────
async function getPaymentStatus(bookingId, userId) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, payments(*), refunds(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);

  return {
    bookingId,
    bookingRef: booking.booking_ref,
    bookStatus: booking.status,
    payment: booking.payments?.[0] || null,
    refund: booking.refunds?.[0] || null,
  };
}

module.exports = {
  initiatePayment,
  confirmPayment,
  failPayment,
  initiateRefund,
  getPaymentStatus,
};
