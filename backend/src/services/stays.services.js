"use strict";

const { supabaseAdmin } = require("../config/supabase");
const logger = require("../config/logger");
const staysIntegration = require("../integrations/duffel/stays.integration");
const {
  generateBookingRef,
  mapDuffelHotelResult,
} = require("../helpers/booking.helper");
const { AppError } = require("../utils/AppError");
const {
  BOOKINGS,
  BOOKING_TYPE,
  HTTP,
  ACTIVITY_LOGS,
  PAGINATION,
} = require("../constants/index");

const POLL_INTERNAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15;

// ── SEARCH HOTELS WITH POLLING  ─────────────────────────────────────────────────────────────
async function searchHotels({
  latitude,
  longitude,
  checkInDate,
  checkOutDate,
  rooms = 1,
  guests = 1,
  radius = 10,
}) {
  const search = await staysIntegration.createSearch({
    latitude,
    longitude,
    checkInDate,
    checkOutDate,
    rooms,
    guests,
    radius,
  });

  let result = search;
  let attempts = 0;

  while (result.status !== "completed" && attempts < POLL_MAX_ATTEMPTS) {
    await new Promise((r) => setTimeout(r, POLL_INTERNAL_MS));
    result = await staysIntegration.getSearchResult(search.id);
    attempts++;
  }
  const hotels = (result.results || []).map(mapDuffelHotelResult);

  return {
    searchId: search.id,
    status: result.status,
    checkInDate,
    checkOutDate,
    rooms,
    guests,
    totalResults: hotels.length,
    hotels,
  };
}

// ── GET HOTEL DETAILS ─────────────────────────────────────────────────────────────
async function getHotelDetails(accommodationId) {
  const accommodation =
    await staysIntegration.getAccommodation(accommodationId);
  return {
    id: accommodation.id,
    name: accommodation.name,
    starRating: accommodation.rating,
    reviewScore: accommodation.review_score,
    address: accommodation.address,
    location: accommodation.geolocation,
    photos: accommodation.photos || [],
    amenities: accommodation.amenities || [],
    description: accommodation.description,
    checkInTime: accommodation.check_in_time,
    checkOutTime: accommodation.check_out_time,
    policies: accommodation.policies,
  };
}

// ── CREATE QUOTE ─────────────────────────────────────────────────────────────
async function createQuote(rateId) {
  const quote = await staysIntegration.createQuote(rateId);
  return {
    quoteId: quote.id,
    rateId: quote.rate_id,
    totalAmount: quote.total_amount,
    totalCurrency: quote.total_currency,
    checkInDate: quote.check_in_date,
    checkOutDate: quote.check_out_date,
    rooms: quote.rooms,
    cancellationTimeline: quote.cancellation_timeline,
    paymentRequired: quote.payment_required_by,
    boardType: quote.board_type,
    expiresAt: quote.expires_at,
  };
}

// ── INITIALIZE HOTEL BOOKING ─────────────────────────────────────────────────────────────
async function initHotelBooking({
  userId,
  rateId,
  hotelId,
  hotelName,
  checkInDate,
  checkOutDate,
  rooms = 1,
  guests = 1,
}) {
  const quote = await staysIntegration.createQuote(rateId);

  if (quote.expires_at && new Date(quote.expires_at) < new Date()) {
    throw new AppError(
      "This hotel rate has expired. Please search again.",
      HTTP.UNPROCESSABLE,
    );
  }
  const bookingRef = generateBookingRef("HTL");

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from("bookings")
    .insert({
      user_id: userId,
      booking_type: BOOKING_TYPE.HOTEL,
      status: BOOKINGS.PENDING_PAYMENT,
      total_amount: parseFloat(quote.total_amount),
      currency: quote.total_currency,
      booking_ref: bookingRef,
    })
    .select()
    .single();

  if (bookingError)
    throw new AppError(
      "Failed to create booking record",
      HTTP.INTERNAL_ERROR,
      bookingError,
    );
  const { error: hotelError } = await supabaseAdmin
    .from("hotel_booking")
    .insert({
      booking_id: booking.id,
      duffel_offer_id: rateId,
      duffel_quote_id: quote.id,
      hotel_id: hotelId || "unknown",
      hotel_name: hotelName || "Hotel",
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      num_rooms: rooms,
      num_guests: guests,
      provider: "duffel",
      offer_data: quote,
    });
  if (hotelError) {
    await supabaseAdmin.from("bookings").delete().eq("id", booking.id);
    throw new AppError(
      "Failed to save hotel booking details",
      HTTP.INTERNAL_ERROR,
      hotelError,
    );
  }

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: booking.id,
    action: ACTIVITY_LOGS.BOOKING_CREATED,
    new_status: BOOKINGS.PENDING_PAYMENT,
    message: `Hotel booking initiated for rate ${rateId}`,
    performed_by: userId,
  });

  logger.info(`[StayService] Booking initiated: ${bookingRef}`, {
    bookingId: booking.id,
  });

  return {
    bookingId: booking.id,
    bookingRef,
    quoteId: quote.id,
    amount: quote.total_amount,
    currency: quote.total_currency,
    paymentRequiredBy: quote.payment_required_by,
  };
}

// ── CONFIRM HOTEL BOOKING ─────────────────────────────────────────────────────────────
async function confirmHotelBooking({
  bookingId,
  userId,
  guests,
  paymentProvider = "stripe",
}) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, hotel_booking(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  if (booking.status === BOOKINGS.CONFIRMED) return { alreadyConfirmed: true };

  const hotelBooking = booking.hotel_booking?.[0];
  const quoteId = hotelBooking?.duffel_quote_id;
  if (!quoteId)
    throw new AppError("Hotel quote data is missing", HTTP.INTERNAL_ERROR);

  const duffelGuests = guests?.length
    ? guests
    : [{ given_name: "Primary", family_name: "Guest", born_on: "1990-01-01" }];

  const duffelBooking = await staysIntegration.createBooking({
    quoteId,
    guests: duffelGuests,
    paymentType: paymentProvider === "duffel" ? "balance" : "balance",
  });

  await supabaseAdmin
    .from("hotel_booking")
    .update({
      duffel_order_id: duffelBooking.id,
      provider_order_id: duffelBooking.id,
    })
    .eq("booking_id", bookingId);

  await supabaseAdmin
    .from("bookings")
    .update({ status: BOOKINGS.CONFIRMED })
    .eq("id", bookingId);

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.BOOKING_CONFIRMED,
    old_status: booking.status,
    new_status: BOOKINGS.CONFIRMED,
    message: `Duffel stays booking: ${duffelBooking.id}`,
    performed_by: userId,
  });

  logger.info(`[StayServices] Booking confirmed: ${booking.booking_ref}`);

  let paymentInstructions = null;
  try {
    paymentInstructions = await staysIntegration.getPaymentInstructions(
      duffelBooking.id,
    );
  } catch (_) {
    /* not all bookings have payment instructions */
  }

  return {
    bookingId,
    bookingRef: booking.booking_ref,
    duffelBookingId: duffelBooking.id,
    status: BOOKINGS.CONFIRMED,
    paymentInstructions,
  };
}

// ── CANCEL HOTEL BOOKING ─────────────────────────────────────────────────────────────
async function cancelHotelBooking(bookingId, userId) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, hotel_booking(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  if (booking.status === BOOKINGS.CANCELLED)
    throw new AppError("Already cancelled", HTTP.UNPROCESSABLE);

  const hotelBooking = booking.hotel_booking?.[0];
  if (hotelBooking?.duffel_order_id) {
    await staysIntegration.cancelBooking(hotelBooking.duffel_order_id);
  }

  await supabaseAdmin
    .from("bookings")
    .update({
      status: BOOKINGS.CANCELLED,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", bookingId);

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.BOOKING_CANCELLED,
    old_status: booking.status,
    new_status: BOOKINGS.CANCELLED,
    performed_by: userId,
  });

  return {
    bookingId,
    bookingRef: booking.booking_ref,
    status: BOOKINGS.CANCELLED,
  };
}

// ── GET / LIST ─────────────────────────────────────────────────────────────
async function getBooking(bookingId, userId) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("*, hotel_booking(*), payments(*)")
    .eq("id", bookingId)
    .single();

  if (error || !data) throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (data.user_id !== userId) throw new AppError("Forbidden", HTTP.FORBIDDEN);
  return data;
}

async function listUserBookings(
  userId,
  {
    page = PAGINATION.DEFAULT_PAGE,
    limit = PAGINATION.DEFAULT_LIMIT,
    status,
  } = {},
) {
  const offset = (page - 1) * limit;
  let query = supabaseAdmin
    .from("bookings")
    .select("*, hotel_booking(*)", { count: "exact" })
    .eq("user_id", userId)
    .eq("booking_type", BOOKING_TYPE.HOTEL)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  const { data, error, count } = await query;
  if (error)
    throw new AppError("Failed to fetch bookings", HTTP.INTERNAL_ERROR, error);
  return { bookings: data, total: count, page, limit };
}

module.exports = {
  searchHotels,
  getHotelDetails,
  createQuote,
  initHotelBooking,
  confirmHotelBooking,
  cancelHotelBooking,
  getBooking,
  listUserBookings,
};
