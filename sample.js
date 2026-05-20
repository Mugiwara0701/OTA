"use strict";

const config = require("./app.config");
const logger = require("./logger");

let provider;
let client;

if (config.payment.provider === "stripe") {
  if (!config.payment.stripe.secretKey) {
    throw new Error(
      "[Payment] STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe",
    );
  }
  const Stripe = require("stripe");
  client = new Stripe(config.payment.stripe.secretKey, {
    apiVersion: "2023-10-16",
    maxNetworkRetries: 2,
    timeout: 10000,
  });
  provider = "stripe";
  logger.info("[Payment] Provider: Stripe (development mode)");
} else {
  // Duffel Managed Payments — payment intents live inside the Duffel SDK
  client = require("./duffel");
  provider = "duffel";
  logger.info("[Payment] Provider: Duffel Managed Payments (production mode)");
}

module.exports = { provider, client };
