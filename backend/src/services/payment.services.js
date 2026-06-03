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

// ── INITIATE PAYMENT ──────────────────────────────────────────────────────────
async function initiatePayment({ bookingId, userId, selectedServices = [] }) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, flight_booking(*)")
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

  // FIX #5: capture the original base fare BEFORE it gets updated with seat costs
  const originalBaseFare = parseFloat(booking.total_amount);
  let finalAmount = originalBaseFare;
  let seatUpgradeAmount = 0;

  if (selectedServices.length > 0) {
    for (const svc of selectedServices) {
      if (!svc.id || !svc.total_amount) {
        throw new AppError(
          "Each selected service must have id and total_amount",
          HTTP.BAD_REQUEST,
        );
      }
      seatUpgradeAmount += parseFloat(svc.total_amount);
    }
    finalAmount = parseFloat((finalAmount + seatUpgradeAmount).toFixed(2));

    const flightBooking = booking.flight_booking?.[0];
    if (flightBooking) {
      await supabaseAdmin
        .from("flight_booking")
        .update({ selected_services: selectedServices })
        .eq("booking_id", bookingId);
    }
    await supabaseAdmin
      .from("bookings")
      .update({ total_amount: finalAmount })
      .eq("id", bookingId);
  }

  await supabaseAdmin
    .from("bookings")
    .update({ status: BOOKINGS.PAYMENT_PROCESSING })
    .eq("id", bookingId);

  let paymentRecord = {};
  let clientResponse = {};

  if (provider === PAYMENT_PROVIDER.STRIPE) {
    // ── Stripe checkout session ──────────────────────────────────────────────
    const session = await client.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: booking.currency.toLowerCase(),
            unit_amount: Math.round(finalAmount * 100),
            product_data: {
              name: `OTA Booking: ${booking.booking_ref}`,
              description:
                seatUpgradeAmount > 0
                  ? `Flight + Seat upgrade (${booking.currency} ${seatUpgradeAmount.toFixed(2)})`
                  : `${booking.booking_type} booking`,
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
      amount: finalAmount,
      currency: booking.currency,
      status: PAYMENT_STATUS.PENDING,
      payment_provider: PAYMENT_PROVIDER.STRIPE,
    };
    clientResponse = {
      provider: "stripe",
      sessionId: session.id,
      sessionUrl: session.url,
      publishableKey: config.payment.stripe.publishableKey,
      pricing: {
        baseFare: originalBaseFare, // FIX #5
        seatUpgrade: seatUpgradeAmount,
        total: finalAmount,
        currency: booking.currency,
      },
    };
  } else {
    // ── Duffel Payments ──────────────────────────────────────────────────────
    //
    // FIXED SDK BUGS vs original code:
    //
    // BUG A: client.payments.intents.create() → does NOT exist.
    //   `client.payments` = air/payments (pays an unpaid order — different thing)
    //   `client.payments.intents` = undefined at runtime → TypeError
    //   CORRECT: client.paymentIntents.create()
    //
    // BUG B: intent.id, intent.client_key → wrong response shape.
    //   The SDK wraps every response: { data: {...}, status, headers }
    //   The field is client_token, not client_key.
    //   CORRECT: intent.data.id, intent.data.client_token
    //
    // BUG C (Fix #2): No metadata on create — webhook can't resolve bookingId.
    //   BUT: CreatePaymentIntent only accepts { amount, currency }.
    //   Metadata is NOT supported by paymentIntents.create().
    //   SOLUTION: store intent_id → booking_id in DB (already done via paymentRecord),
    //   and look it up in the webhook handler by querying the payments table.
    //
    const intentResponse = await client.paymentIntents.create({
      amount: finalAmount.toFixed(2), // must be a string per Duffel API
      currency: booking.currency,
    });
    const intent = intentResponse.data; // unwrap { data: {...} }

    paymentRecord = {
      booking_id: bookingId,
      user_id: userId,
      duffel_payment_intent_id: intent.id,
      duffel_client_key: intent.client_token, // column named client_key; stores client_token value
      amount: finalAmount,
      currency: booking.currency,
      status: PAYMENT_STATUS.PENDING,
      payment_provider: PAYMENT_PROVIDER.DUFFEL,
    };

    // FIX #3: consistent camelCase paymentIntentId (was PaymentIntentId in original)
    clientResponse = {
      provider: "duffel",
      paymentIntentId: intent.id,
      clientToken: intent.client_token, // correct field name for Duffel Payments component
      pricing: {
        baseFare: originalBaseFare, // FIX #5
        seatUpgrade: seatUpgradeAmount,
        total: finalAmount,
        currency: booking.currency,
      },
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
    meta_data: {
      provider,
      bookingRef: booking.booking_ref,
      baseFare: originalBaseFare,
      seatUpgrade: seatUpgradeAmount,
      finalAmount,
      servicesCount: selectedServices.length,
    },
    performed_by: userId,
  });

  logger.info(
    `[PaymentService] Payment initiated for ${booking.booking_ref} via ${provider}. ` +
      `Base: ${booking.currency} ${originalBaseFare}, Seats: +${seatUpgradeAmount}, Total: ${finalAmount}`,
  );
  return clientResponse;
}

// ── CONFIRM PAYMENT ───────────────────────────────────────────────────────────
// Called from: (a) frontend after user completes payment, (b) webhook on success
async function confirmPayment({
  bookingId,
  sessionId, // Stripe only
  paymentIntentId, // FIX #3: was "PaymentIntentId" — consistent camelCase now
  userId,
}) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();
  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);

  // FIX #4: idempotency guard — prevents race between frontend confirm + webhook
  if (booking.status === BOOKINGS.CONFIRMED) {
    logger.info(
      `[PaymentService] confirmPayment: booking ${bookingId} already confirmed — skipping`,
    );
    return {
      bookingId,
      bookingRef: booking.booking_ref,
      status: BOOKINGS.CONFIRMED,
    };
  }

  if (provider === PAYMENT_PROVIDER.STRIPE && sessionId) {
    // ── Stripe: verify session with Stripe before confirming ─────────────────
    const session = await client.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      throw new AppError("Payment not completed by Stripe", HTTP.UNPROCESSABLE);
    }
    await supabaseAdmin
      .from("payments")
      .update({
        stripe_payment_intent_id: session.payment_intent,
        status: PAYMENT_STATUS.COMPLETED,
        paid_at: new Date().toISOString(),
      })
      .eq("booking_id", bookingId);
  } else if (provider === PAYMENT_PROVIDER.DUFFEL) {
    // ── FIX #1: Duffel — verify payment intent status before confirming ───────
    // ORIGINAL: no verification at all — ticket was created without checking payment
    // NOW: always call Duffel API to confirm intent status === "succeeded"
    //
    // Resolve intent ID: prefer what was passed in; fall back to DB lookup.
    // This covers both paths:
    //   (a) frontend passes paymentIntentId after Duffel Payments component resolves
    //   (b) webhook handler passes it from data.id in the event payload
    let resolvedIntentId = paymentIntentId;
    if (!resolvedIntentId) {
      const { data: paymentRecord } = await supabaseAdmin
        .from("payments")
        .select("duffel_payment_intent_id")
        .eq("booking_id", bookingId)
        .single();
      resolvedIntentId = paymentRecord?.duffel_payment_intent_id;
    }
    if (!resolvedIntentId) {
      throw new AppError(
        "Duffel payment intent ID missing — cannot verify payment",
        HTTP.UNPROCESSABLE,
      );
    }

    // Verify with Duffel — correct SDK method: client.paymentIntents.get()
    // Response is wrapped: { data: { id, status, ... }, status: 200, headers }
    const intentResponse = await client.paymentIntents.get(resolvedIntentId);
    const intent = intentResponse.data; // unwrap
    if (intent.status !== "succeeded") {
      logger.warn(
        `[PaymentService] Duffel intent ${resolvedIntentId} not succeeded — status: ${intent.status}`,
      );
      throw new AppError(
        `Duffel payment not confirmed (status: ${intent.status})`,
        HTTP.UNPROCESSABLE,
      );
    }

    await supabaseAdmin
      .from("payments")
      .update({
        status: PAYMENT_STATUS.COMPLETED,
        paid_at: new Date().toISOString(),
      })
      .eq("booking_id", bookingId);
  } else {
    throw new AppError(
      "Unable to verify payment — unknown provider or missing identifiers",
      HTTP.UNPROCESSABLE,
    );
  }

  // ── Create airline/hotel/car order & mark booking confirmed ───────────────
  await confirmProviderBooking(booking, provider);

  await supabaseAdmin
    .from("bookings")
    .update({ status: BOOKINGS.CONFIRMED })
    .eq("id", bookingId);

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.PAYMENT_COMPLETED,
    old_status: booking.status,
    new_status: BOOKINGS.CONFIRMED,
    meta_data: { provider },
    performed_by: userId || "system",
  });

  const emailService = require("./email.services");
  emailService
    .sendPaymentReceived({
      userId: booking.user_id,
      bookingRef: booking.booking_ref,
      amount: booking.total_amount,
      currency: booking.currency,
    })
    .catch(() => {});

  logger.info(
    `[PaymentService] Payment confirmed for booking: ${booking.booking_ref}`,
  );

  return {
    bookingId,
    bookingRef: booking.booking_ref,
    status: BOOKINGS.CONFIRMED,
  };
}

// ── INTERNAL: DISPATCH TO PROVIDER-SPECIFIC BOOKING CONFIRMATION ──────────────
async function confirmProviderBooking(booking, paymentProvider) {
  const { BOOKING_TYPE } = require("../constants/index");
  if (booking.booking_type === BOOKING_TYPE.FLIGHT) {
    const { data: flightBooking } = await supabaseAdmin
      .from("flight_booking")
      .select("selected_services")
      .eq("booking_id", booking.id)
      .single();
    const selectedServices = flightBooking?.selected_services || [];
    const flightService = require("./flight.services");
    await flightService.confirmFlightBooking({
      bookingId: booking.id,
      userId: booking.user_id,
      paymentProvider,
      selectedServices,
    });
  } else if (booking.booking_type === BOOKING_TYPE.HOTEL) {
    const staysService = require("./stays.services");
    await staysService.confirmStaysBooking({
      bookingId: booking.id,
      userId: booking.user_id,
      paymentProvider,
    });
  } else if (booking.booking_type === BOOKING_TYPE.CAR) {
    const carService = require("./car.services");
    await carService.confirmCarBooking({
      bookingId: booking.id,
      userId: booking.user_id,
      paymentProvider,
    });
  }
}

// ── FAIL PAYMENT ──────────────────────────────────────────────────────────────
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

// ── INITIATE REFUND ───────────────────────────────────────────────────────────
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

  const emailService = require("./email.services");
  const { data: bk } = await supabaseAdmin
    .from("bookings")
    .select("booking_ref")
    .eq("id", bookingId)
    .single();
  emailService
    .sendRefundInitiated({
      userId: payment.user_id,
      bookingRef: bk?.booking_ref,
      refundAmount,
      currency: payment.currency,
    })
    .catch(() => {});

  logger.info(`[PaymentService] Refund initiated for booking: ${bookingId}`);

  return {
    bookingId,
    refundAmount,
    currency: payment.currency,
    status: refundRecord.status,
  };
}

// ── GET PAYMENT STATUS ────────────────────────────────────────────────────────
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
