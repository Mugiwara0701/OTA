"use strict";

const express = require("express");
const router = express.Router();
const controller = require("../controllers/notification.controller");
const { authenticate } = require("../middleware/auth.middleware");

// All notification routes are protected — a user must be logged in
router.use(authenticate);

// GET  /api/v1/notifications?page=1&limit=10&unread=true
router.get("/", controller.getNotifications);

// GET  /api/v1/notifications/unread-count
// NOTE: This must come BEFORE /:id so Express does not treat
//       "unread-count" as a UUID param and route it to markAsRead.
router.get("/unread-count", controller.getUnreadCount);

// PATCH /api/v1/notifications/read-all
router.patch("/read-all", controller.markAllAsRead);

// PATCH /api/v1/notifications/:id/read
router.patch("/:id/read", controller.markAsRead);

// DELETE /api/v1/notifications/:id
router.delete("/:id", controller.deleteNotification);

module.exports = router;
