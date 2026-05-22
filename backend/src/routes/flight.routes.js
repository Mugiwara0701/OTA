"use strict";

const express = require("express");
const router = express.Router();
const controller = require("../controllers/flight.controller");
const { authenticate } = require("../middleware/auth.middleware");
const {
  searchFlightRules,
  initBookingRules,
  bookingIdParamRules,
  offerIParamsRules,
  changeRequestRules,
} = require("../validators/flight.validators");

// ── PUBLIC SEARCH ─────────────────────────────────────────────────────────────
router.post("/search", searchFlightRules, controller.searchFlights);
router.get("/offers/:offerId", offerIParamsRules, controller.getOffer);
router.get("/offers/:offerId/seat-map", controller.getSeatMap);

// ── AUTHENTICATED ─────────────────────────────────────────────────────────────
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
