"use strict";

const { body, query, validationResult } = require("express-validator");
const { sendError } = require("../helpers/helper.response");
const { HTTP } = require("../constants/index");
const { AppError } = require("../utils/AppError");

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      new AppError("Validation failed", HTTP.UNPROCESSABLE, errors.array()),
    );
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
    .withMessage("Password must be at least 8 characters.")
    .matches(/[A-Z]/)
    .withMessage("Password must contain at least one uppercase letter.")
    .matches(/[0-9]/)
    .withMessage("Password must contain at least one number.")
    .matches(/[^A-Za-z0-9]/)
    .withMessage("Password must contain at least one special character."),

  body("firstName")
    .trim()
    .notEmpty()
    .withMessage("First name is required.")
    .isLength({ max: 50 })
    .escape(),

  body("lastName")
    .trim()
    .notEmpty()
    .withMessage("Last name is required.")
    .isLength({ max: 50 })
    .escape(),

  body("phone").trim().notEmpty().withMessage("Phone number is required."),

  body("dateOfBirth")
    .notEmpty()
    .withMessage("Date of birth is required.")
    .isISO8601()
    .withMessage("Date of birth must be YYYY-MM-DD."),

  body("nationality").trim().notEmpty().withMessage("Nationality is required."),

  body("passportNumber")
    .trim()
    .notEmpty()
    .withMessage("Passport number is required.")
    .isLength({ max: 20 }),

  validate,
];

// ── Login ──────────────────────────────────────────────────────────────────
const loginValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("A valid email address is required.")
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
    .isLength({ max: 50 })
    .escape(),

  body("lastName")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Last name cannot be empty.")
    .isLength({ max: 50 })
    .escape(),

  body("phone")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Phone number cannot be empty."),

  body("dateOfBirth")
    .optional()
    .isISO8601()
    .withMessage("Date of birth must be YYYY-MM-DD."),

  body("nationality")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Nationality cannot be empty."),

  body("passportNumber")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Passport number cannot be empty")
    .isLength({ max: 20 }),
  validate,
];

// ── Forgot Password ───────────────────────────────────────────────────────────
const forgotPasswordValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("A valid email address is required")
    .normalizeEmail(),
  validate,
];

// ── Reset Password ────────────────────────────────────────────────────────────
const resetPasswordValidator = [
  body("token").notEmpty().withMessage("Token is required"),

  body("newPassword")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/[A-Z]/)
    .withMessage("Password must contain at least one uppercase letter.")
    .matches(/[0-9]/)
    .withMessage("Password must contain at least one number.")
    .matches(/[^A-Za-z0-9]/)
    .withMessage("Password must contain at least one special character."),
  validate,
];

// ── Change Password ────────────────────────────────────────────────────────────
const changePasswordValidator = [
  body("currentPassword")
    .notEmpty()
    .withMessage("Current password is required."),

  body("newPassword")
    .isLength({ min: 8 })
    .withMessage("New password must be at least 8 characters.")
    .matches(/[A-Z]/)
    .withMessage("New password must contain at least one uppercase letter.")
    .matches(/[0-9]/)
    .withMessage("New password must contain at least one number.")
    .matches(/[^A-Za-z0-9]/)
    .withMessage("New password must contain at least one special character."),

  body("confirmNewPassword").custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error("Passwords do not match.");
    }
    return true;
  }),

  validate,
];

module.exports = {
  registerValidator,
  loginValidator,
  updateProfileValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
};
