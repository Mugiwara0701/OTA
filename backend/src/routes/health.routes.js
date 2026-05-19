"use strict";

const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "OTA Platform API running",
    environment: process.env.NODE_ENV,
    version: process.env.API_VERSION || "v1",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
