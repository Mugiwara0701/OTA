"use strict";

const app = require("./src/app");
const config = require("./src/config/app.config");
const logger = require("./src/config/logger");

const PORT = config.server.port || 5000;

const server = app.listen(PORT, () => {
  logger.info(`OTA Server running on port ${PORT}`, {
    env: config.server.env,
    api: `/api/${config.server.apiVersion}`,
  });
});

process.on("SIGTERM", () => {
  logger.info("[Server] SIGTERM — shutting down gracefully");
  server.close(() => {
    logger.info("[Server] Closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

process.on("unhandledRejection", (reason) => {
  logger.error("[Server] Unhandled Rejection", { reason });
});

process.on("uncaughtException", (err) => {
  logger.error("[Server] Uncaught Exception", { error: err.message });
  process.exit(1);
});

module.exports = server;
