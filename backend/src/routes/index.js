"use strict";

const express = require("express");
const router = express.Router();

// ──────────────────────────────────────────────────────────────

const healthRoute = require("./health.routes");
const authRoute = require("./auth.routes");

// ──────────────────────────────────────────────────────────────
router.use("/health", healthRoute);
router.use("/auth", authRoute);
