"use strict";

const Amadeus = require("amadeus");
const config = require("./app.config");
const logger = require("./logger");

const amadeus = new Amadeus({
  clientId: config.amadeus.clientId,
  clientSecret: config.amadeus.clientSecret,
  hostname: config.amadeus.hostname,
  loglevel: config.server.isDev ? "debug" : "silent",
});

logger.info("[AMADEUS] Client initialized", {
  hostname: config.amadeus.hostname,
  environment: "sandbox",
});

module.exports = amadeus;
