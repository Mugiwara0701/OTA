"use strict";

const { supabaseAdmin } = require("../config/supabase");
const logger = require("../config/logger");
const { AppError } = require("../utils/AppError");
const { NOTIFICATION_TYPES, HTTP, PAGINATION } = require("../constants/index");

// ──── CREATE ──────────────────────────────────────────────────────────────
async function createNotification({
  userId,
  type,
  title,
  message,
  metadata = {},
}) {
  if (!userId) return null;

  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      user_id: userId,
      type,
      title,
      message,
      meta_data: metadata,
      is_read: false,
    })
    .select()
    .single();

  if (error) {
    logger.error(`[NotificationsService] failed to create notification`, {
      userId,
      type,
      error,
    });
    return null;
  }
  logger.debug(`[NotificationService] Created: ${type} for usee ${userId}`);

  return data;
}

// ──── GET USERS NOTIFICATIONS ──────────────────────────────────────────────────────────────
async function getUserNotifications(
  userId,
  {
    page = PAGINATION.DEFAULT_PAGE,
    limit = PAGINATION.DEFAULT_LIMIT,
    unreadOnly = false,
  } = {},
) {
  const offset = (page - 1) * limit;
  let query = supabaseAdmin
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (unreadOnly) query = query.eq("is_read", false);

  const { data, error, count } = await query;
  if (error)
    throw new AppError(
      "Failed to fetch notifications",
      HTTP.INTERNAL_ERROR,
      error,
    );

  return { notifications: data, total: count, page, limit };
}

// ──── GET UNREAD COUNT ──────────────────────────────────────────────────────────────
async function getUnreadCount(userId) {
  const { count, error } = await supabaseAdmin
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error)
    throw new AppError(
      "Failed to count notifications",
      HTTP.INTERNAL_ERROR,
      error,
    );
  return { count: count || 0 };
}

// ──── MARK SINGLE AS READ ──────────────────────────────────────────────────────────────
async function markAsRead(notificationId, userId) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw new AppError("Notification not found", HTTP.NOT_FOUND);
  return data;
}

// ──── MARK ALL AS READ ──────────────────────────────────────────────────────────────
async function markAllAsRead(userId) {
  const { error, count } = await supabaseAdmin
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error)
    throw new AppError(
      "Failed to mark notification as read",
      HTTP.INTERNAL_ERROR,
      error,
    );

  return { updated: count || 0 };
}

// ──── DELETE ──────────────────────────────────────────────────────────────
async function deleteNotification(notificationId, userId) {
  const { error } = await supabaseAdmin
    .from("notifications")
    .delete()
    .eq("id", notificationId)
    .eq("user_id", userId);
  if (error)
    throw new AppError(
      "Notification not found or access denied",
      HTTP.NOT_FOUND,
    );
  return { deleted: true };
}

// ──── CONVENIENCE HELPERS USED INSIDE OTHER SERVICES ──────────────────────────────────────────────────────────────
const TEMPLATES = {
  bookingConfirmed: (bookingRef, type) => ({
    type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
    title: `${type} Booking confirmed`,
    message: `Your ${type.toLowerCase()} booking ${bookingRef} has been confirmed`,
  }),
  paymentProcessed: (bookingRef, amount, currency) => ({
    type: NOTIFICATION_TYPES.PAYMENT_PROCESSED,
    title: "Payment Successful",
    message: `Payment of ${amount} ${currency} received for booking ${bookingRef}.`,
  }),
  refundInitiated: (bookingRef, amount, currency) => ({
    type: NOTIFICATION_TYPES.REFUND_PROCESSED,
    title: "Refund Initiated",
    message: `Refund of ${amount} ${currency} has been initiated for booking ${bookingRef}.`,
  }),
  bookingCancelled: (bookingRef) => ({
    type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
    title: "Booking Cancelled",
    message: `Booking ${bookingRef} has been cancelled.`,
  }),
};

module.exports = {
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  TEMPLATES,
};
