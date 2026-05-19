"use strict";

const logger = require("../config/app.config");
const { AppError } = require("../utils/AppError");
const { HTTP } = require("../constants/index");

function handleJWTError() {
  return new AppError(
    "Invalid authentication token. Please login again.",
    HTTP.UNAUTHORIZED,
  );
}

function handleJWTExpiredError() {
  return new AppError(
    "Your session has been expired. Please login again.",
    HTTP.UNAUTHORIZED,
  );
}

function handleSupabaseError(err) {
  if (err.code === "23505")
    new AppError("A record with that value already exists.", HTTP.CONFLICT);
  if (err.code === "23503")
    new AppError("Reference record doesn't exists.", HTTP.BAD_REQUEST);
  return new AppError("Database error occurred", HTTP.INTERNAL_ERROR);
}

// ── Dev error: full details in response ───────────────────────────────────────
function sendDevError(err, res) {
  res.status(err.statusCode || HTTP.INTERNAL_ERROR).json({
    success: false,
    message: err.message,
    stack: err.stack,
    details: err.details || null,
    errors: err.errors || null,
  });
}

// ── Prod error: safe, no internals ────────────────────────────────────────────
function sendProdError(err, res) {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors || null,
    });
  } else {
    logger.errors("[UNHANDLED ERROR]", {
      message: err.message,
      stack: err.stack,
    });
    res.status(HTTP.INTERNAL_ERROR).json({
      success: false,
      message: "Something went wrong. Please try again later",
    });
  }
}

// ── Main error handler middleware ─────────────────────────────────────────────
function errorHandler(err, req, res, next) {
  let error = { ...err, message: err.message, stack: err.stack };

  if (err.name === "JSONWebTokenError") error = handleJWTError();
  if (err.name === "TokenExpiredError") error = handleJWTExpiredError();
  if (err.code && /^[0-9A-Z]{5}$/.test(err.code)) {
    error = handleSupabaseError();
  }

  if (err.array && typeof err.array === "function") {
    error = new AppError("Validation failed", HTTP.UNPROCESSABLE, err.array());
  }

  logger.error(`[${req.method}] ${req.originalUrl}`, {
    message: error.message,
    statusCode: error.statusCode,
    ip: req.ip,
    userId: req.user?.id || "unauthenticated",
  });

  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    sendDevError(error, res);
  } else {
    if (!error.isOperational) {
      error.isOperational = false;
      error.statusCode = error.statusCode || HTTP.INTERNAL_ERROR;
    }
    sendProdError(error, res);
  }
}

function notFoundHandler(req, res, next) {
  next(
    new AppError(
      `Route not found: ${req.method} ${req.originalUrl}`,
      HTTP.NOT_FOUND,
    ),
  );
}

module.exports = { errorHandler, notFoundHandler };
