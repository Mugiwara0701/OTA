"use strict";

require("dotenv").config();

// Function that check all the keys that are required before the server starts are there in the .env file
function requiredEnv(keys) {
  const value = process.env[keys];
  if (!value || value.trim() === "") {
    throw new Error(
      `[Config] Missing required environment variable: "${key}". ` +
        `Copy .env.example → .env and fill in the value.`,
    );
  }
  return value.trim();
}

// Read the env variables and returns the fallback if absent
function optionalEnv(keys, defaultValue = "") {
  return (process.env[keys] || defaultValue).trim();
}

// Validate and export the configuration object

const NODE_ENV = optionalEnv("NODE_ENV", "development");

const config = {
  // ── Server ──────────────────────
  server: {
    env: NODE_ENV,
    port: parseInt(optionalEnv("PORT", "5000"), 10),
    apiVersion: optionalEnv("API_VERSION", "v1"),
    isDev: NODE_ENV === "development",
    isProd: NODE_ENV === "production",
  },
  // ── SUPABASE ──────────────────────
  supabase: {
    url: requiredEnv("SUPABASE_URL"),
    anonKey: requiredEnv("SUPABASE_ANON_KEY"),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  },
  // ── JWT ──────────────────────
  jwt: {
    secret: requiredEnv("JWT_SECRET"),
    expiresIn: optionalEnv("JWT_EXPIRES_IN", "7d"),
    refreshTokenExpiresIn: optionalEnv("JWT_REFRESH_TOKEN_EXPIRES_IN", "30d"),
  },

  // ── DUFFEL ──────────────────────
  duffel: {
    accessToken: requiredEnv("DUFFEL_ACCESS_TOKEN"),
    webhookSecret: optionalEnv("DUFFEL_WEBHOOK_SECRET", ""),
  },

  // ── PAYMENT ──────────────────────
  payment: {
    provider: optionalEnv(
      "PAYMENT_PROVIDER",
      NODE_ENV === "production" ? "duffel" : "stripe",
    ),
    stripe: {
      secretKey: requiredEnv("STRIPE_SECRET_KEY"),
      publishableKey: requiredEnv("STRIPE_PUBLISHABLE_KEY"),
      webhookSecret: requiredEnv("STRIPE_WEBHOOK_SECRET"),
    },
  },
  // ── Cors ──────────────────────
  cors: {
    allowedOrigins: optionalEnv("CORS_ALLOWED_ORIGINS", "*").split(","),
  },
  // ── Rate Limiting ──────────────────────
  rateLimit: {
    windowMs: parseInt(optionalEnv("RATE_LIMIT_WINDOW_MS", "900000"), 10),
    maxRequests: parseInt(optionalEnv("RATE_LIMIT_MAX_REQUESTS", "100"), 10),
  },
  // ── Logging ──────────────────────
  logging: {
    level: optionalEnv("LOG_LEVEL", "debug"),
    dir: optionalEnv("LOG_DIR", "src/logs"),
  },
};

module.exports = config;
