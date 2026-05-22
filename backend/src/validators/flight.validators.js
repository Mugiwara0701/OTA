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
const DATE_REGEX = /^\d{4}-\d{2}-d{2}$/;

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

  validate,
];

const initBookingRules = [
  body("offerId").notEmpty().withMessage().withMessage("OfferId is required"),

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
    .isIn(["MALE", "FEMALE", "OTHER"])
    .withMessage("Invalid gender"),

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

const bookingIdParamRules = [
  param("bookingId").isUUID().withMessage("Invalid booking ID"),

  validate,
];

const offerIParamsRules = [
  param("bookingId").isUUID().withMessage("OfferId is required"),

  validate,
];

const changeRequestRules = [
  param("bookingId").isUUID(),

  body("slices")
    .isObject()
    .withMessage("slices must be an object with add/remove array"),

  validate,
];

module.exports = {
  searchFlightRules,
  initBookingRules,
  bookingIdParamRules,
  offerIParamsRules,
  changeRequestRules,
};
