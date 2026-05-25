"use strict";

const notificationService = require("../services/notification.services");
const { AppError, asyncHandler } = require("../utils/AppError");
const { sendSuccess, paginationMeta } = require("../helpers/helper.response");
const { HTTP, PAGINATION } = require("../constants/index");

// GET /api/v1/notifications?page=1&limit=10&unread=true
const getNotifications = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE;
  const limit = parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT;
  const unreadOnly = req.query.unread === "true";
  const { notifications, total } =
    await notificationService.getUserNotifications(req.user.id, {
      page,
      limit,
      unreadOnly,
    });
  return sendSuccess(
    res,
    HTTP.OK,
    "Notifications retrieved",
    notifications,
    paginationMeta(page, limit, total),
  );
});

// GET /api/v1/notifications/unread-count
const getUnreadCount = asyncHandler(async (req, res) => {
  const result = await notificationService.getUnreadCount(req.user.id);
  return sendSuccess(res, HTTP.OK, "Unread count retrieved", result);
});

// PATCH /api/v1/notifications/:id/read
const markAsRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAsRead(
    req.params.id,
    req.user.id,
  );
  return sendSuccess(res, HTTP.OK, "Notifications marked as read", result);
});

// PATCH /api/v1/notifications/read-all
const markAllAsRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllAsRead(req.user.id);
  return sendSuccess(
    res,
    HTTP.OK,
    `${result.updated} notifications marked as read`,
    result,
  );
});

// DELETE /api/v1/notifications/:id
const deleteNotification = asyncHandler(async (req, res) => {
  const result = await notificationService.deleteNotification(
    req.params.id,
    req.user.id,
  );
  return sendSuccess(res, HTTP.OK, "Notification deleted", result);
});

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
