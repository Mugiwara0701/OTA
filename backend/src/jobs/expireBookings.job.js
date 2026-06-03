"use strict";

const { supabaseAdmin } = require("../config/supabase");
const logger = require("../config/logger");
const { BOOKINGS } = require("../constants/index");

async function expireStaleBookings() {
  try {
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

    const now = new Date();
    const expiredIds = stale
      .filter((b) => {
        const fb = b.flight_booking?.[0];
        if (!fb?.offer_expires_at) return false;
        return new Date(fb.offer_expires_at) < now;
      })
      .map((b) => b.id);

    if (expiredIds.length === 0) return;

    const { error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        status: BOOKINGS.FAILED,
        updated_at: now.toISOString(),
      })
      .in("id", expiredIds);

    if (updateError) {
      logger.error("[ExpireJob] Failed to expire bookings", {
        error: updateError.message,
      });
      return;
    }

    logger.info(
      `[ExpireJob] Expired ${expiredIds.length} stale PENDING_PAYMENT booking(s)`,
      {
        ids: expiredIds,
      },
    );
  } catch (err) {
    logger.error("[ExpireJob] Unexpected error", { error: err.message });
  }
}

function startExpireBookingsJob() {
  const INTERVAL_MS = 5 * 60 * 1000;

  // Run immediately on startup to catch anything that expired while server was down
  expireStaleBookings();

  const timer = setInterval(expireStaleBookings, INTERVAL_MS);
  timer.unref(); // don't block process exit

  logger.info("[ExpireJob] Booking expiry job started — interval: 5 min");
}

module.exports = { startExpireBookingsJob, expireStaleBookings };
