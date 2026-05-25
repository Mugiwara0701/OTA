"use strict";

const express = require("express");

// ── PAYMENT ROUTER ─────────────────────────────────────────────────────────────
const paymentRouter = express.Router();
const paymentController = require("../controllers/payment.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { body, param, validationResult } = require("express-validator");
const { AppError } = require("../utils/AppError");
const { HTTP } = require("../constants/index");

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return next(
      new AppError("Validation failed", HTTP.UNPROCESSABLE, errors.array()),
    );
  next();
};

paymentRouter.post(
  "/initiate",
  authenticate,
  [
    body("bookingId").isUUID().withMessage("Valid bookingId required"),
    validate,
  ],
  paymentController.initiatePayment,
);

paymentRouter.post(
  "/confirm",
  authenticate,
  [body("bookingId").isUUID(), validate],
  paymentController.confirmPayment,
);

paymentRouter.post(
  "/:bookingId/refund".authenticate,
  [param("bookingId").isUUID(), validate],
  paymentController.refundPayment,
);

paymentRouter.get(
  "/:bookingId/status",
  authenticate,
  [param("bookingId").isUUID(), validate],
  paymentController.getPaymentStatus,
);

// ── WEBHOOK ROUTER ─────────────────────────────────────────────────────────────
const webhookRouter = express.Router();
const webhookController = require("../controllers/webhook.controller");

webhookRouter.post("/stripe", webhookController.handleStripeWebHook);
webhookRouter.post("/duffel", webhookController.handleDuffelWebhook);

module.exports = { paymentRouter, webhookRouter };
