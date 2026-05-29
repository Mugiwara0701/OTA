"use strict";

const express = require("express");
const router = express.Router();

const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authLimiter } = require("../middleware/rateLimiter.middleware");
const {
  registerValidator,
  loginValidator,
  updateProfileValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
} = require("../validators/auth.validators");

// ── PUBLIC ────────────────────────────────────────────────────────────────────
router.post("/register", registerValidator, authController.register);
router.post("/login", loginValidator, authController.login);
router.post("/refresh", authController.refresh);
router.get("/verify-email", authController.verifyEmail);
router.post(
  "/forgot-password",
  authLimiter,
  forgotPasswordValidator,
  authController.forgotPassword,
);
router.post(
  "/reset-password",
  authLimiter,
  resetPasswordValidator,
  authController.resetPassword,
);

// ── PROTECTED ────────────────────────────────────────────────────────────────────
router.post("/logout", authenticate, authController.logout);
router.get("/me", authenticate, authController.getMe);
router.patch(
  "/me",
  authenticate,
  updateProfileValidator,
  authController.updateMe,
);
router.post(
  "/change-password",
  authenticate,
  changePasswordValidator,
  authController.changePassword,
);

module.exports = router;
