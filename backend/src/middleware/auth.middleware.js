"use strict";

const jwt = require("jsonwebtoken");
const config = require("../config/app.config");
const { AppError } = require("../utils/AppError");
const { HTTP } = require("../constants/index");

// ── Authenticate ──────────────────────────────────────────────────────────────
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(
      new AppError(
        "Authentication required. Please provide a valid Bearer token.",
      ),
    );
  }

  const token = authHeader.split(" ")[1];

  try {
    const decode = jwt.verify(token, config.jwt.secret);

    req.user = {
      id: decode.sub,
      email: decode.email,
      roles: decode.roles || [],
    };
    next();
  } catch (err) {
    next(err);
  }
};

// ── Authorize (RBAC guard) ────────────────────────────────────────────────────

const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError("Authentication required.", HTTP.UNAUTHORIZED));
    }
    const userRoles = req.user.roles;

    if (userRoles.includes("SUPER_ADMIN")) {
      return next();
    }

    const hasRoles = allowedRoles.some((role) => userRoles.includes(role));

    if (!hasRoles) {
      return next(
        new AppError(
          `Access denied. required roles: ${allowedRoles.join(" or ")}.`,
        ),
      );
    }
    next();
  };
};

const optionalAuthentication = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(" ")[1];

  try {
    const decode = jwt.verify(token, config.jwt.secret);
    req.user = {
      id: decode.sub,
      email: decode.email,
      roles: decode.roles || [],
    };
  } catch (err) {
    req.user = null;
  }

  next();
};

module.exports = { authenticate, authorize, optionalAuthentication };
