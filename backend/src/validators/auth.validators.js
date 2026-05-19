"use strict";

const { body, validationResult } = require("express-validator");
const { sendError } = require("../helpers/helper.response");
const { HTTP } = require("../constants/index");

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendError;
    (res, HTTP.UNPROCESSABLE, "Validation failed", errors.array());
  }
  next();
};

// ── Register ──────────────────────────────────────────────────────────────────
const registerValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("A valid email address is required.")
    .normalizeEmail(),

  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 character.")
    .matches(/[A-Z]/)
    .withMessage("Password must contains at least on Uppercase.")
    .matches(/[0-9]/)
    .withMessage("Password must contains at least one number."),

  body("firstName")
    .trim()
    .notEmpty()
    .withMessage("First name required.")
    .isLength({ max: 50 })
    .withMessage("First name must be under 50 characters."),

  body("lastName")
    .trim()
    .notEmpty()
    .withMessage("Last name required.")
    .isLength({ max: 50 })
    .withMessage("Last name must be under 50 characters."),

  body("phone").trim().notEmpty().withMessage("Phone number is required."),

  body("dateOfBirth")
    .notEmpty()
    .withMessage("Date of Birth required")
    .isISO8601()
    .withMessage("Date of birth must be a valid date (YYYY-MM-DD)."),

  body("nationality").trim().notEmpty().withMessage("Nationality is required."),

  body("passportNumber")
    .trim()
    .notEmpty()
    .withMessage("Passport number required."),
  validate,
];

// ── Login ──────────────────────────────────────────────────────────────────
const loginValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email address is required")
    .normalizeEmail(),

  body("password").notEmpty().withMessage("Password is required"),

  validate,
];

// ── Update Profile ──────────────────────────────────────────────────────────────────

const updateProfileValidator = [
  body("firstName")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("First name cannot be empty.")
    .isLength({ max: 50 }),

  body("lastName")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Last name cannot be empty.")
    .isLength({ max: 50 }),

  body("phone")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Phone number cannot be empty."),

  body("dateOfBirth")
    .optional()
    .isISO8601()
    .withMessage("Date of birth cannot be empty."),

  body("nationality")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Nationality cannot be empty."),

  body("passportNumber")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Passport number cannot be empty"),
  validate,
];

module.exports = { registerValidator, loginValidator, updateProfileValidator };
