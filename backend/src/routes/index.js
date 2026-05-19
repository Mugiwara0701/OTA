"use strict";

const express = require("express");
const router = express.Router();

// ──────────────────────────────────────────────────────────────

const healthRoute = require("./health.routes");

// ──────────────────────────────────────────────────────────────
router.use("/health", healthRoute);
