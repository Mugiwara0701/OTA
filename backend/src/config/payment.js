"use strict";

const config = require("./app.config");
const logger = require("./logger");
const { AppError } = require("../utils/AppError");
const { HTTP } = require("../constants/index");

let client;
let provider;

if (config.payment.provider === "stripe") {
  if (!config.payment.stripe.secretKey) {
    throw new AppError(
      `[Payment] Stripe secret key required when payment provider is stripe`,
      HTTP.UNAUTHORIZED,
    );
  }
  const Stripe = require("stripe");
  client = new Stripe(config.payment.stripe.secretKey, {
    apiVersion: "2023-10-16",
    maxNetworkRetries: 2,
    timeout: 10000,
  });
  provider = "stripe";
  logger.info(`[Payment] Provider: Stripe (Development Mode)`);
} else {
  client = require("./duffel");
  provider = "duffel";
  logger.info(`[Payment] Provider: Duffel Managed Payments (Production mode)`);
}

module.exports = { client, provider };
