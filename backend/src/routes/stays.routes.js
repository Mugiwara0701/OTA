"use strict";

const express = require("express");
const router = express.Router();
const controller = require("../controllers/stays.controller");
const { authenticate } = require("../middleware/auth.middleware");
const {
  searchHotelRules,
  createQuoteRules,
  initHotelBookingRules,
  confirmHotelBookingRules,
  bookingIdParamRules,
} = require("../validators/stays.cars.validators");

// ── PUBLIC ─────────────────────────────────────────────────────────────
router.post("/search", searchHotelRules, controller.searchHotels);
router.get("/results/:resultId/rates", controller.getHotelRates);
router.get("/accommodations/:accommodationId", controller.getAccommodation);

// ── AUTHENTICATED ─────────────────────────────────────────────────────────────
router.post("/quotes", authenticate, createQuoteRules, controller.createQuote);
router.post(
  "/book",
  authenticate,
  initHotelBookingRules,
  controller.initBooking,
);
router.post(
  "/booking/:bookingId/confirm",
  authenticate,
  confirmHotelBookingRules,
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
  "/bookings/:bookingId/cancel",
  authenticate,
  bookingIdParamRules,
  controller.cancelBooking,
);

module.exports = router;
