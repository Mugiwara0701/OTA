"use strict";

const { DUffel } = require("@duffel/api");
const config = require("./app.config");
const logger = require("./logger");

const duffel = new Duffel({
  token: config.duffel.accessToken,
});

const isLive = config.duffel.accessToken.startsWith("duffel_live");

logger.info(
  `[Duffel] Client initalized - mode: ${isLive ? "Live 🔴" : "TEST 🟡"}`,
);

module.exports = duffel;
