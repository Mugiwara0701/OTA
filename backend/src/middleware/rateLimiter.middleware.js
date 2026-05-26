"use strict";

const rateLimit = require("express-rate-limit");
const config = require("../config/app.config");

// ── Global limiter ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

// ── Search limiter — expensive: hits Duffel API (billed per call in prod) ────
const searchLimiter = rateLimit({
  windowMs: config.rateLimit.searchWindowMs,
  max: config.rateLimit.searchMax,
  keyGenerator: (req) => req.user?.id || req.ip, // per-user if authenticated
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Search rate limit reached. Please wait a moment and try again.",
  },
});

// ── Auth limiter — brute-force protection ─────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failures against the limit
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again later.",
  },
});

// ── Admin limiter ─────────────────────────────────────────────────────────────
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many admin requests." },
});

module.exports = { globalLimiter, searchLimiter, authLimiter, adminLimiter };
