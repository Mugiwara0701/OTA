"use strict";

const crypto = require("crypto");
const { provider, client } = require("../config/payment");
const config = require("../config/app.config");
const logger = require("../config/logger");
const paymentService = require("../services/payment.services");
const { asyncHandler } = require("../utils/AppError");
const { error } = require("console");

// ── STRIPE WEBHOOK ─────────────────────────────────────────────────────────────

// POST /api/v1/webhooks/stripe
const handleStripeWebHook = asyncHandler(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  if (!config.payment.stripe.webhookSecret) {
    logger.warn(`[Webhook] Stripe webhook secret not configured`);
    return res.status(400).json({
      success: false,
      message: "Webhook not configured",
    });
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
            PaymentIntentId: session.payment_intent,
            userId: userId || "webhook",
          });
          logger.info(
            `[webhook] Stripe payment confirmed for booking: ${bookingId}`,
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
      case "charge.refunded": {
        logger.info(`[Webhook] Stripe charge refunded`, {
          chargeId: event.data.object.id,
        });
        break;
      }
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

// POST /api/v1/webhooks/duffel
const handleDuffelWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers["duffel-signature"];
  if (config.duffel.webhookSecret && signature) {
    const expectedSig = crypto
      .createHmac("sha256", config.duffel.webhookSecret)
      .update(req.rawBody)
      .digest("hex");

    if (`sha256=${expectedSig}` !== signature) {
      logger.error(`[Webhook] Duffel signature verification failed`);
      return res.status(400).json({
        success: false,
        message: "Invalid Duffel webhook signature",
      });
    }
  }
  res.status(200).json({ received: true });
  let payload;
  try {
    payload = JSON.parse(req.rawBody.toString());
  } catch (err) {
    logger.error(`[Webhook] Invalid duffel webhook payload`);
    return;
  }
  const { type, data } = payload;
  logger.info(`[Webhook] Duffel event received: ${type}`);

  try {
    switch (type) {
      case "payment_intent.succeeded": {
        const bookingId = data?.metadata?.booking_id;
        if (bookingId) {
          await paymentService.confirmPayment({ bookingId, userId: "webhook" });
          logger.info(
            `[Webhook] Duffel payment confirmed for booking: ${bookingId}`,
          );
        }
        break;
      }
      case "payment_intent.payment_failed": {
        const bookingId = data?.metadata?.booking_id;
        if (bookingId) {
          await paymentService.failPayment({
            bookingId,
            reason: "Duffel payment intent failed",
          });
        }
        break;
      }
      case "order.updated": {
        logger.info(`[Webhook] Duffel order updated`, { orderId: data?.id });
        break;
      }
      case "order.airline_initiated_change": {
        logger.warn(`[Webhook] Airline-initiated change received`, {
          orderId: data?.id,
        });
        break;
      }
      case "stays.booking.updated": {
        logger.info(`[Webhook] Duffel stay booking updated`, {
          bookingId: data?.id,
        });
        break;
      }
      default:
        logger.debug(`[Webhook] Unhandled Duffel event: ${type}`);
    }
  } catch (err) {
    logger.error(`[Webhook] Error processing Duffel event`, {
      type,
      error: err.message,
    });
  }
});

module.exports = { handleStripeWebHook, handleDuffelWebhook };
