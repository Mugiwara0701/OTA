"use strict";

const { body, param, validationResult } = require("express-validator");
const { AppError } = require("../utils/AppError");
const { HTTP } = require("../constants/index");

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new AppError("Validation failed", HTTP.UNPROCESSABLE, errors.array()),
    );
  }
  next();
};

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}/;

// ── STAYS ─────────────────────────────────────────────────────────────
const searchHotelRules = [
  body("latitude")
    .isFloat({ min: -90, max: 90 })
    .withMessage("Valid latitude required"),

  body("longitude")
    .isFloat({ min: -180, max: 180 })
    .withMessage("Valid longitude required"),

  body("checkInDate")
    .matches(DATE_REGEX)
    .withMessage("checkInDate must be YYYY-MM-DD"),

  body("checkOutDate")
    .matches(DATE_REGEX)
    .withMessage("checkOutDate must be YYYY-MM-DD"),

  body("rooms")
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage("Rooms must be 1–10"),

  body("guests")
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage("Guests must be 1–20"),

  body("radius")
    .optional()
    .isFloat({ min: 1, max: 50 })
    .withMessage("Radius must be 1–50 km"),

  validate,
];

const createQuoteRules = [
  body("rateId").notEmpty().withMessage("rateId is requires"),

  validate,
];

const initHotelBookingRules = [
  body("rateId").notEmpty().withMessage("rateId is required"),

  body("checkInDate")
    .matches(DATE_REGEX)
    .withMessage("checkInDate must be YYYY-MM-DD"),

  body("checkOutDate")
    .matches(DATE_REGEX)
    .withMessage("checkOutDate must be YYYY-MM-DD"),

  body("rooms").optional().isInt({ min: 1, max: 10 }),

  body("guests").optional().isInt({ min: 1, max: 20 }),

  validate,
];

const confirmHotelBookingRules = [
  param("bookingId").isUUID(),

  body("guests").optional().isArray().withMessage("guests must be an array"),

  body("guests.*.given_name").optional().notEmpty(),

  body("guests.*.family_name").optional().notEmpty(),

  validate,
];

// ── CARS ─────────────────────────────────────────────────────────────

const IATA_REGEX = /^[A-Z]{3}$/;
const ISO_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const searchCarsRules = [
  body("pickupLocationIata")
    .trim()
    .toUpperCase()
    .matches(IATA_REGEX)
    .withMessage("pickupLocationIata must be 3-letter IATA code"),

  body("dropoffLocationIata")
    .trim()
    .toUpperCase()
    .matches(IATA_REGEX)
    .withMessage("dropoffLocationIata must be 3-letter IATA code"),

  body("pickupDateTime")
    .matches(ISO_DATETIME_REGEX)
    .withMessage("pickupDateTime must be ISO 8601 format"),

  body("dropoffDateTime")
    .matches(ISO_DATETIME_REGEX)
    .withMessage("dropoffDateTime must be ISO 8601 format"),

  body("driverAge")
    .optional()
    .isInt({ min: 18, max: 99 })
    .withMessage("driverAge must be 18-99"),

  validate,
];

const initCarBookingRules = [
  body("rateId").notEmpty().withMessage("rateID is required"),

  validate,
];

const confirmCarBookingRules = [
  param("bookingId").isUUID(),

  body("driver").isObject().withMessage("driver object is required"),

  body("driver.given_name")
    .notEmpty()
    .withMessage("Driver given_name required"),

  body("driver.family_name")
    .notEmpty()
    .withMessage("Driver family_name required"),

  body("driver.born_on")
    .matches(DATE_REGEX)
    .withMessage("Driver born_on must be YYYY-MM-DD"),

  body("driver.phone_number")
    .notEmpty()
    .withMessage("Driver phone_number required"),

  body("driver.email").isEmail().withMessage("Driver email required"),

  body("driver.license_number")
    .notEmpty()
    .withMessage("Driver license_number required"),

  body("driver.license_country")
    .isLength({ min: 2, max: 3 })
    .withMessage("Driver license_country ISO code required"),

  validate,
];

const bookingIdParamRules = [
  param("bookingId").isUUID().withMessage("Invalid booking ID"),

  validate,
];

module.exports = {
  searchHotelRules,
  createQuoteRules,
  initHotelBookingRules,
  confirmHotelBookingRules,
  searchCarsRules,
  initCarBookingRules,
  confirmCarBookingRules,
  bookingIdParamRules,
};
