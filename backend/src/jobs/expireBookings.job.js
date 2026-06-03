"use strict";

const { supabaseAdmin } = require("../config/supabase");
const logger = require("../config/logger");
const { BOOKINGS } = require("../constants/index");

async function expireStaleBookings() {
  try {
    const now = new Date().toISOString();

    // Find all PENDING_PAYMENT flight bookings whose offer has expired
    const { data: stale, error } = await supabaseAdmin
      .from("bookings")
      .select("id, flight_booking(offer_expires_at)")
      .eq("status", BOOKINGS.PENDING_PAYMENT)
      .eq("booking_type", "FLIGHT");

    if (error) {
      logger.error("[ExpireJob] Failed to fetch stale bookings", {
        error: error.message,
      });
      return;
    }

    if (!stale || stale.length === 0) return;

    const expiredIds = stale
      .filter((b) => {
        const fb = b.flight_booking?.[0];
        if (!fb?.offer_expires_at) return true; // no expiry = treat as expired
        return new Date(fb.offer_expires_at) < new Date();
      })
      .map((b) => b.id);

    if (expiredIds.length === 0) return;

    // Hard delete — cascades to flight_booking, travelers, booking_logs
    // (ensure your DB foreign keys have ON DELETE CASCADE)
    const { error: deleteError } = await supabaseAdmin
      .from("bookings")
      .delete()
      .in("id", expiredIds);

    if (deleteError) {
      logger.error("[ExpireJob] Failed to delete expired bookings", {
        error: deleteError.message,
      });
      return;
    }

    logger.info(
      `[ExpireJob] Deleted ${expiredIds.length} expired PENDING_PAYMENT booking(s)`,
      { ids: expiredIds },
    );
  } catch (err) {
    logger.error("[ExpireJob] Unexpected error", { error: err.message });
  }
}

function startExpireBookingsJob() {
  const INTERVAL_MS = 60 * 1000; // every 1 minute

  // Run immediately on startup to clear anything that expired while server was down
  expireStaleBookings();

  const timer = setInterval(expireStaleBookings, INTERVAL_MS);
  timer.unref();

  logger.info("[ExpireJob] Booking expiry job started — interval: 1 min");
}

module.exports = { startExpireBookingsJob, expireStaleBookings };
