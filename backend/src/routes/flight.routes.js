"use strict";

const express = require("express");
const router = express.Router();
const controller = require("../controllers/flight.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { searchLimiter } = require("../middleware/rateLimiter.middleware");
const {
  searchFlightRules,
  initBookingRules,
  bookingIdParamRules,
  offerIdParamRules,
  changeRequestRules,
  listOffersRules,
} = require("../validators/flight.validators");

// ── PUBLIC ─────────────────────────────────────────────────────────────────────
router.post(
  "/search",
  searchLimiter,
  searchFlightRules,
  controller.searchFlights,
);
router.get("/offers", searchLimiter, listOffersRules, controller.listOffers);
router.get("/offers/:offerId", offerIdParamRules, controller.getOffer);
router.get("/offers/:offerId/seat-map", controller.getSeatMap);

// ── AUTHENTICATED ──────────────────────────────────────────────────────────────
router.post("/book", authenticate, initBookingRules, controller.initBooking);

router.post(
  "/bookings/:bookingId/confirm",
  authenticate,
  bookingIdParamRules,
  controller.confirmBooking,
);

router.get("/bookings", authenticate, controller.listBookings);

router.get(
  "/bookings/:bookingId",
  authenticate,
  bookingIdParamRules,
  controller.getBooking,
);

router.post(
  "/bookings/:bookingId/cancel",
  authenticate,
  bookingIdParamRules,
  controller.cancelBooking,
);

// ── Refund status — also available at GET /payments/:bookingId/status ────────
// Convenience alias so flight consumers don't need to know the payments route
router.get(
  "/bookings/:bookingId/refund-status",
  authenticate,
  bookingIdParamRules,
  controller.getRefundStatus,
);

// ── Change flow ────────────────────────────────────────────────────────────────
router.post(
  "/bookings/:bookingId/change-request",
  authenticate,
  changeRequestRules,
  controller.createChangeRequest,
);

router.get(
  "/bookings/:bookingId/change-offers",
  authenticate,
  controller.listChangeOffers,
);

router.post(
  "/bookings/:bookingId/change/confirm",
  authenticate,
  controller.confirmChange,
);

module.exports = router;
