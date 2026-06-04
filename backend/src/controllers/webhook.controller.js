"use strict";

const crypto = require("crypto");
const { provider, client } = require("../config/payment");
const config = require("../config/app.config");
const logger = require("../config/logger");
const paymentService = require("../services/payment.services");
const { asyncHandler } = require("../utils/AppError");
const { supabaseAdmin } = require("../config/supabase");

// ── STRIPE WEBHOOK ─────────────────────────────────────────────────────────────
const handleStripeWebHook = asyncHandler(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  if (!config.payment.stripe.webhookSecret) {
    logger.warn(`[Webhook] Stripe webhook secret not configured`);
    return res
      .status(400)
      .json({ success: false, message: "Webhook not configured" });
  }
  let event;
  try {
    event = client.webhooks.constructEvent(
      req.rawBody,
      sig,
      config.payment.stripe.webhookSecret,
    );
  } catch (err) {
    logger.error("[Webhook] Stripe signature verification failed", {
      error: err.message,
    });
    return res.status(400).json({
      success: false,
      message: `Webhook signature failed: ${err.message}`,
    });
  }

  res.status(200).json({ received: true });

  try {
    const { bookingId, userId } = event.data.object?.metadata || {};
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.payment_status === "paid" && bookingId) {
          await paymentService.confirmPayment({
            bookingId,
            sessionId: session.id,
            paymentIntentId: session.payment_intent,
            userId: userId || "webhook",
          });
          logger.info(
            `[Webhook] Stripe payment confirmed for booking: ${bookingId}`,
          );
        }
        break;
      }
      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        const failedBookingId = intent.metadata?.bookingId;
        if (failedBookingId) {
          await paymentService.failPayment({
            bookingId: failedBookingId,
            reason:
              intent.last_payment_error?.message || "Stripe payment failed",
          });
          logger.warn(
            `[Webhook] Stripe payment failed for booking: ${failedBookingId}`,
          );
        }
        break;
      }
      case "charge.refunded":
        logger.info(`[Webhook] Stripe charge refunded`, {
          chargeId: event.data.object.id,
        });
        break;
      default:
        logger.debug(`[Webhook] Unhandled Stripe event: ${event.type}`);
    }
  } catch (err) {
    logger.error(`[Webhook] Error processing Stripe event`, {
      type: event.type,
      error: err.message,
    });
  }
});

// ── DUFFEL WEBHOOK ─────────────────────────────────────────────────────────────
const handleDuffelWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers["duffel-signature"];

  // FIX #6: enforce HMAC verification — never accept unsigned webhooks
  // In production, DUFFEL_WEBHOOK_SECRET is required (enforced in app.config.js).
  // In development, if the secret is set we verify; if not, we warn and allow through.
  if (config.duffel.webhookSecret) {
    if (!signature) {
      logger.error(
        `[Webhook] Duffel webhook received without signature header`,
      );
      return res
        .status(400)
        .json({ success: false, message: "Missing Duffel-Signature header" });
    }
    const expectedSig = crypto
      .createHmac("sha256", config.duffel.webhookSecret)
      .update(req.rawBody)
      .digest("hex");
    // timingSafeEqual prevents timing attacks
    const expected = Buffer.from(`sha256=${expectedSig}`);
    const received = Buffer.from(signature);
    const valid =
      expected.length === received.length &&
      crypto.timingSafeEqual(expected, received);
    if (!valid) {
      logger.error(`[Webhook] Duffel signature verification failed`);
      return res
        .status(400)
        .json({ success: false, message: "Invalid Duffel webhook signature" });
    }
  } else {
    logger.warn(
      `[Webhook] DUFFEL_WEBHOOK_SECRET not set — skipping HMAC check (dev only)`,
    );
  }

  res.status(200).json({ received: true });

  let payload;
  try {
    payload = JSON.parse(req.rawBody.toString());
  } catch {
    logger.error(`[Webhook] Invalid Duffel webhook payload — not valid JSON`);
    return;
  }

  const { type, data } = payload;
  logger.info(`[Webhook] Duffel event received: ${type}`);

  try {
    switch (type) {
      case "payment_intent.succeeded": {
        // FIX #2 alternative: Since paymentIntents.create() doesn't support metadata,
        // we correlate using the intent ID → look it up in the payments table.
        // The payments table has duffel_payment_intent_id stored from initiatePayment.
        const intentId = data?.id;
        if (!intentId) {
          logger.error(`[Webhook] payment_intent.succeeded missing data.id`);
          break;
        }

        // Look up booking via the stored intent ID
        const { data: paymentRecord, error } = await supabaseAdmin
          .from("payments")
          .select("booking_id")
          .eq("duffel_payment_intent_id", intentId)
          .single();

        if (error || !paymentRecord?.booking_id) {
          logger.error(
            `[Webhook] payment_intent.succeeded: no booking found for intent ${intentId}`,
          );
          break;
        }

        await paymentService.confirmPayment({
          bookingId: paymentRecord.booking_id,
          paymentIntentId: intentId, // pass through so confirmPayment skips DB re-fetch
          userId: "webhook",
        });
        logger.info(
          `[Webhook] Duffel payment confirmed for booking: ${paymentRecord.booking_id}`,
        );
        break;
      }

      case "payment_intent.payment_failed": {
        const intentId = data?.id;
        if (!intentId) break;

        const { data: paymentRecord } = await supabaseAdmin
          .from("payments")
          .select("booking_id")
          .eq("duffel_payment_intent_id", intentId)
          .single();

        if (paymentRecord?.booking_id) {
          await paymentService.failPayment({
            bookingId: paymentRecord.booking_id,
            reason: `Duffel payment intent failed (intent: ${intentId})`,
          });
          logger.warn(
            `[Webhook] Duffel payment failed for booking: ${paymentRecord.booking_id}`,
          );
        } else {
          logger.error(
            `[Webhook] payment_intent.payment_failed: no booking found for intent ${intentId}`,
          );
        }
        break;
      }

      case "order.updated":
        logger.info(`[Webhook] Duffel order updated`, { orderId: data?.id });
        break;

      case "order.airline_initiated_change": {
        const orderId = data?.id;
        logger.warn(`[Webhook] Airline-initiated change received`, { orderId });
        if (orderId) {
          const { data: flightBooking } = await supabaseAdmin
            .from("flight_booking")
            .select("booking_id, bookings(user_id, booking_ref)")
            .eq("duffel_order_id", orderId)
            .maybeSingle();

          if (flightBooking?.bookings) {
            // Acknowledge the change back to Duffel so it doesn't stay pending.
            // We auto-accept — if your business needs manual review, change to
            // a queue/task and call this after a support agent reviews.
            try {
              const flightIntegration = require("../integrations/duffel/flight.integration");
              const order = await flightIntegration.getOrder(orderId);
              const airlineChanges = order.airline_initiated_changes || [];
              for (const change of airlineChanges) {
                if (change.available_actions?.includes("accept")) {
                  await flightIntegration.acceptAirlineInitiatedChange(
                    change.id,
                  );
                  logger.info(
                    `[Webhook] Airline-initiated change accepted: ${change.id}`,
                  );
                }
              }
            } catch (ackErr) {
              logger.error(
                `[Webhook] Failed to acknowledge airline change for order ${orderId}: ${ackErr.message}`,
              );
            }

            const emailService = require("../services/email.services");
            emailService
              .sendAirlineChangeAlert({
                userId: flightBooking.bookings.user_id,
                bookingRef: flightBooking.bookings.booking_ref,
                orderId,
              })
              .catch(() => {});
            await supabaseAdmin.from("booking_logs").insert({
              booking_id: flightBooking.booking_id,
              action: "AIRLINE_INITIATED_CHANGE",
              message: `Airline initiated a schedule change for order ${orderId}`,
              meta_data: { orderId },
            });
          }
        }
        break;
      }

      case "stays.booking.updated":
        logger.info(`[Webhook] Duffel stay booking updated`, {
          bookingId: data?.id,
        });
        break;

      default:
        logger.debug(`[Webhook] Unhandled Duffel event: ${type}`);
    }
  } catch (err) {
    logger.error(`[Webhook] Error processing Duffel event`, {
      type,
      error: err.message,
      stack: err.stack,
    });
  }
});

module.exports = { handleStripeWebHook, handleDuffelWebhook };
