"use strict";

const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const path = require("path");
const config = require("./app.config");
const fs = require("fs");
const { error } = require("console");

// ── ENSURE LOGS DIRECTORY EXISTS ─────────────────────────────────────────────────────────────────
const logDir = path.resolve(config.logging.dir);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// ── CUSTOM FORMAT FOR CONSOLE LOGS ─────────────────────────────────────────────────────────────────
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? `\n ${JSON.stringify(meta, null, 2)}`
      : "";
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
  winston.format.errors({ stack: true }),
);

// ── TRANSPORTS  ─────────────────────────────────────────────────────────────────

// console transport for development and suppressed in the production environment

const transports = [];

if (!config.server.isProd) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
    }),
  );
}

// Combine all logs
transports.push(
  new DailyRotateFile({
    filename: path.join(logDir, `combined-%DATE%.log`),
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxSize: "20mb",
    maxFiles: "30d",
    format: fileFormat,
  }),
);

// Error Logs
transports.push(
  new DailyRotateFile({
    filename: path.join(logDir, `error-%DATE%.log`),
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxSize: "20mb",
    maxFiles: "30d",
    format: fileFormat,
  }),
);

// ── Logger instance ───────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: config.logging.level,
  transports,
  exitOnError: false,
});

module.exports = logger;
