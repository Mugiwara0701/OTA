"use strict";

const express = require("express");
const router = express.Router();

const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth.middleware");
const {
  registerValidator,
  loginValidator,
  updateProfileValidator,
} = require("../validators/auth.validators");

// ── PUBLIC ────────────────────────────────────────────────────────────────────
router.post("/register", registerValidator, authController.register);
router.post("/login", loginValidator, authController.login);
router.post("/refresh", authController.refresh);

// ── PROTECTED ────────────────────────────────────────────────────────────────────
router.get("/me", authenticate, authController.getMe);
router.patch(
  "/me",
  authenticate,
  updateProfileValidator,
  authController.updateMe,
);

module.exports = router;
