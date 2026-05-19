"use strict";

const morgan = require("morgan");
const logger = require("../config/logger");

const stream = {
  write: (message) => logger.http(message.trim()),
};

const skip = (req) => {
  return req.originalUrl === "/health" || req.originalUrl === "/ping";
};

const requestLogger = morgan(
  ":method :url :status :res[content-length] - :response-time ms",
  { stream, skip },
);

module.exports = requestLogger;
