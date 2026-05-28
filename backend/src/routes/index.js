"use strict";

const express = require("express");
const router = express.Router();

// ── Core ──────────────────────────────────────────────────────────────────────
router.use("/health", require("./health.routes"));
router.use("/auth", require("./auth.routes"));

// ── Booking Modules ───────────────────────────────────────────────────────────
router.use("/flights", require("./flight.routes"));
router.use("/stays", require("./stays.routes"));
router.use("/cars", require("./car.routes"));

// ── Payments + Webhooks ────────────────────────────────────────────────────────
const { paymentRouter, webhookRouter } = require("./payment-webhook.routes");
router.use("/payments", paymentRouter);
router.use("/webhooks", webhookRouter); // raw body applied in app.js for this prefix

// ── Notifications ─────────────────────────────────────────────────────────────
// router.use("/notifications", require("./notification.routes"));

// // ── Support Tickets (customer) ────────────────────────────────────────────────
// router.use("/support", require("./support.routes"));

// // ── Meta / Reference Data (public) ───────────────────────────────────────────
router.use("/meta", require("./supporting.routes"));

// // ── Admin ─────────────────────────────────────────────────────────────────────
// router.use("/admin", require("./admin/index.routes"));

module.exports = router;
