"use strict";

const Stripe = require("stripe");
const config = require("./app.config");
const logger = require("./logger");

if (!config.stripe?.secretKey) {
  throw new Error("Stripe secret key is missing");
}

const stripe = new Stripe(config.stripe.secretKey, {
  apiVersion: "2023-10-16",
  maxNetworkRetries: 2,
  timeout: 10000,
});

const isLive = config.stripe.secretKey.startsWith("sk_live");

logger.info("[Stripe] Client initialized", {
  mode: isLive ? "live" : "test",
});

module.exports = stripe;
