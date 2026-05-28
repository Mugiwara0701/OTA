"use strict";

const { body, param, query, validationResult } = require("express-validator");
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

const IATA_REGEX = /^[A-Z]{3}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const searchFlightRules = [
  body("origin")
    .trim()
    .toUpperCase()
    .matches(IATA_REGEX)
    .withMessage("Origin must be a 3 letter IATA code"),

  body("destination")
    .trim()
    .toUpperCase()
    .matches(IATA_REGEX)
    .withMessage("Destination must be a 3 letter IATA code"),

  body("departureDate")
    .optional()
    .matches(DATE_REGEX)
    .withMessage("departure date must be YYYY-MM-DD"),

  body("returnDate")
    .optional()
    .matches(DATE_REGEX)
    .withMessage("returnDate must be YYYY-MM-DD"),

  body("adults")
    .optional()
    .isInt({ min: 1, max: 9 })
    .withMessage("adults must be 1-9"),

  body("children")
    .optional()
    .isInt({ min: 0, max: 8 })
    .withMessage("children must be 0-8"),

  body("infants")
    .optional()
    .isInt({ min: 0, max: 4 })
    .withMessage("infants must be 0-4"),

  body("cabinClass")
    .optional()
    .isIn(["economy", "premium_economy", "business", "first"])
    .withMessage("Invalid cabin class"),

  body("maxConnections").optional().isInt({ min: 0, max: 2 }),

  body("sortBy")
    .optional()
    .isIn(["total_amount", "duration", "stops"])
    .withMessage("sortBy must be total_amount, duration, or stops."),

  body("maxPrice")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("maxPrice must be a positive number.")
    .toFloat(),

  body("maxStops").optional().isInt({ min: 0, max: 2 }).toInt(),

  body("airlines").optional().isArray(),

  validate,
];

// ── Init Booking ──────────────────────────────────────────────────────────────
const initBookingRules = [
  body("offerId").notEmpty().withMessage("OfferId is required"),

  body("passengers")
    .isArray({ min: 1 })
    .withMessage("At least one passenger required"),

  body("passengers.*.firstName")
    .notEmpty()
    .withMessage("Passenger first name required"),

  body("passengers.*.lastName")
    .notEmpty()
    .withMessage("Passenger last name required"),

  body("passengers.*.bornOn")
    .matches(DATE_REGEX)
    .withMessage("Passenger bornOn must be YYYY-MM-DD"),

  body("passengers.*.gender")
    .toUpperCase()
    .isIn(["MALE", "FEMALE", "OTHER"])
    .withMessage("Invalid gender"),

  body("passengers.*.title")
    .optional()
    .toLowerCase()
    .isIn(["mr", "ms", "mrs", "dr"])
    .withMessage("Title must be mr, ms, mrs, or dr"),

  body("passengers.*.passportNumber")
    .notEmpty()
    .withMessage("Passport number required"),

  body("passengers.*.passportExpiry")
    .matches(DATE_REGEX)
    .withMessage("passportExpiry must be YYYY-MM-DD"),

  body("passengers.*.nationality")
    .isLength({ min: 2, max: 3 })
    .withMessage("Nationality ISO code required"),

  body("passengers.*.email").optional().isEmail(),

  body("passengers.*.phone").optional().isMobilePhone("any"),

  body("tripType").optional().isIn(["ONE_WAY", "ROUND_TRIP", "MULTI_CITY"]),

  validate,
];

// ── Params ────────────────────────────────────────────────────────────────────
const bookingIdParamRules = [
  param("bookingId").isUUID().withMessage("Invalid booking ID"),

  validate,
];

const offerIdParamRules = [
  param("offerId").notEmpty().withMessage("Invalid offer ID"),
  validate,
];

// ── Change Request ─────────────────────────────────────────────────────────────
// Accepts slices as an ARRAY of objects, each with slice_id, origin,
// destination, departure_date. The service layer converts this into the
// { add: [...], remove: [...] } shape that Duffel expects.
//
// Example body:
// {
//   "slices": [
//     {
//       "slice_id": "sli_00009htYpSCXrwaB9Dn123",
//       "origin": "DEL",
//       "destination": "BOM",
//       "departure_date": "2026-09-01"
//     }
//   ]
// }
const changeRequestRules = [
  param("bookingId").isUUID().withMessage("Invalid booking ID"),

  body("slices")
    .isArray({ min: 1 })
    .withMessage("slices must be a non-empty array of slice objects"),

  body("slices.*.slice_id")
    .notEmpty()
    .withMessage("Each slice must have a slice_id (from the original order)"),

  body("slices.*.origin")
    .trim()
    .toUpperCase()
    .matches(IATA_REGEX)
    .withMessage("Each slice must have a valid 3-letter IATA origin code"),

  body("slices.*.destination")
    .trim()
    .toUpperCase()
    .matches(IATA_REGEX)
    .withMessage("Each slice must have a valid 3-letter IATA destination code"),

  body("slices.*.departure_date")
    .matches(DATE_REGEX)
    .withMessage("Each slice must have a departure_date in YYYY-MM-DD format"),

  body("slices.*.cabin_class")
    .optional()
    .isIn(["economy", "premium_economy", "business", "first"])
    .withMessage(
      "cabin_class must be economy, premium_economy, business, or first",
    ),

  validate,
];

// ── List Offers (Phase 3 filter rules) ───────────────────────────────────────
const listOffersRules = [
  query("offerRequestId").notEmpty().withMessage("OfferRequestId is required."),
  query("sortBy").optional().isIn(["total_amount", "duration", "stops"]),
  query("maxPrice").optional().isFloat({ min: 0 }).toFloat(),
  query("maxStops").optional().isInt({ min: 0, max: 2 }).toInt(),
  query("airlines").optional(),
  validate,
];

module.exports = {
  searchFlightRules,
  initBookingRules,
  bookingIdParamRules,
  offerIdParamRules,
  offerIParamsRules: offerIdParamRules, // alias for backward compat
  changeRequestRules,
  listOffersRules,
};
