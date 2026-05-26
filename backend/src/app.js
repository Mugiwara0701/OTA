"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const config = require("./config/app.config");
const logger = require("./config/logger");
const apiRoutes = require("./routes/index");
const requestLogger = require("./middleware/requestLogger.middleware");
const {
  errorHandler,
  notFoundHandler,
} = require("./middleware/errorHandler.middleware");

const app = express();

// use to to automatically set the security headers in the response and also prevent from XSS attacks
app.use(helmet());

// CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.cors.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      logger.warn(`CORS request blocked from origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
  }),
);

// ── Raw body for webhook signature verification ───────────────────────────────\
app.use(
  `/api/${config.server.apiVersion}/webhooks`,
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body;
    next();
  },
);

// ── JSON + URL-encoded body parsers ───────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(compression()); // Compression

// Rate limiting middleware to prevent abuse and DoS attacks
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
  },
});

app.use("/api/", limiter);

app.use(requestLogger); // Request Logging

app.use(`/api/${config.server.apiVersion}`, apiRoutes); // API Routes

app.use(notFoundHandler); // 404 Handler

app.use(errorHandler); // Global Error Handler

module.exports = app;
