"use strict";

/**
 * E-Ticket Controller
 *
 * GET  /api/v1/flights/bookings/:bookingId/eticket
 *   → streams the e-ticket PDF to the caller
 *
 * POST /api/v1/flights/bookings/:bookingId/eticket/email
 *   → regenerates the e-ticket and sends it to the passenger's email
 */

const { asyncHandler } = require("../utils/AppError");
const { supabaseAdmin } = require("../config/supabase");
const flightIntegration = require("../integrations/duffel/flight.integration");
const { mapDuffelOrder } = require("../helpers/booking.helper");
const { generateETicketPDF } = require("../services/eticket.service");
const { sendETicketEmail } = require("../services/email.services"); // added below
const AppError = require("../utils/AppError");
const { HTTP, BOOKINGS } = require("../constants/index");

// ── Shared: load all data needed to build the ticket ─────────────────────────
async function loadETicketData(bookingId, userId) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, flight_booking(*), travelers(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  if (booking.status !== BOOKINGS.CONFIRMED) {
    throw new AppError(
      "E-ticket is only available for confirmed bookings",
      HTTP.UNPROCESSABLE,
    );
  }

  const flightBooking = booking.flight_booking?.[0];
  if (!flightBooking?.duffel_order_id) {
    throw new AppError(
      "Flight order not found for this booking",
      HTTP.NOT_FOUND,
    );
  }

  // Fetch live order from Duffel (contains seat assignments, PNR, documents)
  const rawOrder = await flightIntegration.getOrder(
    flightBooking.duffel_order_id,
  );
  const order = mapDuffelOrder(rawOrder);

  // Load user profile for personalisation
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("first_name, last_name, email")
    .eq("id", booking.user_id)
    .single();

  return {
    booking,
    flightBooking,
    order,
    user,
    travelers: booking.travelers || [],
  };
}

// ── GET /api/v1/flights/bookings/:bookingId/eticket ───────────────────────────
const downloadETicket = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;

  const data = await loadETicketData(bookingId, userId);
  const pdfBuffer = await generateETicketPDF(data);

  const filename = `eticket-${data.booking.booking_ref}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.end(pdfBuffer);
});

// ── POST /api/v1/flights/bookings/:bookingId/eticket/email ────────────────────
const emailETicket = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;

  const data = await loadETicketData(bookingId, userId);
  const pdfBuffer = await generateETicketPDF(data);

  await sendETicketEmail({
    userId: data.booking.user_id,
    bookingRef: data.booking.booking_ref,
    pdfBuffer,
  });

  return res.status(HTTP.OK).json({
    success: true,
    message: "E-ticket sent to your registered email address",
  });
});

module.exports = { downloadETicket, emailETicket };
