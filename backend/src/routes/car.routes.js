"use strict";

const express = require("express");
const router = express.Router();
const controller = require("../controllers/car.controller");
const { authenticate } = require("../middleware/auth.middleware");
const {
  searchCarsRules,
  initCarBookingRules,
  confirmCarBookingRules,
  bookingIdParamRules,
} = require("../validators/stays.cars.validators");

// ── PUBLIC ─────────────────────────────────────────────────────────────
router.post("/search", searchCarsRules, controller.searchCars);
router.get("/quotes/:quoteId", controller.getQuote);

// ── AUTHENTICATE ─────────────────────────────────────────────────────────────
router.post(
  "/quotes",
  authenticate,
  initCarBookingRules,
  controller.createQuote,
);
router.post("/book", authenticate, initCarBookingRules, controller.initBooking);
router.post(
  "/bookings/:bookingId/confirm",
  authenticate,
  confirmCarBookingRules,
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

module.exports = router;
