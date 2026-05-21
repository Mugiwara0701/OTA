"use strict";

const { supabaseAdmin } = require("../config/supabase");
const logger = require("../config/logger");
const carsIntegration = require("../integrations/duffel/car.integration");
const {
  generateBookingRef,
  mapDuffelCarResult,
} = require("../helpers/booking.helper");
const { AppError } = require("../utils/AppError");
const {
  BOOKINGS,
  BOOKING_TYPE,
  HTTP,
  ACTIVITY_LOGS,
  PAGINATION,
} = require("../constants/index");

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15;

// ── SEARCH CARS  ─────────────────────────────────────────────────────────────
async function searchCars({
  pickupLocationIata,
  dropOffLocationIata,
  pickupDateTime,
  dropOffDateTime,
  driverAge = 30,
}) {
  const search = await carsIntegration.createSearch({
    pickupLocationIata,
    dropoffLocationIata,
    pickupDateTime,
    dropoffDateTime,
    driverAge,
  });

  let result = search;
  let attempts = 0;

  while (result.status !== "completed" && attempts < POLL_MAX_ATTEMPTS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    result = await carsIntegration.getSearchResult(search.id);
    attempts++;
  }

  const cars = (result.results || []).map(mapDuffelCarResult);

  return {
    searchId: search.id,
    status: result.status,
    pickupLocation: pickupLocationIata,
    dropoffLocation: dropOffLocationIata,
    pickupAt: pickupDateTime,
    dropoffAt: dropOffDateTime,
    totalResults: cars.length,
    cars,
  };
}

// ── GET QUOTE  ─────────────────────────────────────────────────────────────
async function getQuoteDetail(quoteId) {
  const quote = await carsIntegration.getQuote(quoteId);
  return {
    quoteId: quote.id,
    vehicle: quote.vehicle,
    pickupLocation: quote.pickup_location,
    dropoffLocation: quote.drop_off_location,
    pickupAt: quote.pick_up_date_time,
    dropoffAt: quote.drop_off_date_time,
    totalAmount: quote.total_amount,
    totalCurrency: quote.total_currency,
    conditions: quote.conditions,
    includedServices: quote.included_services,
    expiresAt: quote.expires_at,
  };
}

// ── INITIALIZE CAR BOOKING  ─────────────────────────────────────────────────────────────
async function initCarBooking({
  userId,
  rateId,
  pickupLocation,
  dropoffLoaction,
  pickupDate,
  dropoffDate,
  carType,
}) {
  const quote = await carsIntegration.createQuote(rateId);

  if (quote.expires_At && new Date(quote.expires_at) < new Date()) {
    throw new AppError(
      "This car rental rate has expired. Please search again.",
      HTTP.UNPROCESSABLE,
    );
  }

  const bookingRef = generateBookingRef("CAR");

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from("bookings")
    .insert({
      user_id: userId,
      booking_type: BOOKING_TYPE.CAR,
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

  const { error: carError } = await supabaseAdmin.from("car_booking").insert({
    booking_id: booking.id,
    duffel_offer_id: rateId,
    duffel_quote_id: quote.id,
    pickup_location:
      pickupLocation || quote.pickup_location?.iata_code || "UNKNOWN",
    dropoff_location:
      dropoffLocation || quote.drop_off_location?.iata_code || "UNKNOWN",
    pickup_date: pickupDate || quote.pick_up_date_time,
    dropoff_date: dropoffDate || quote.drop_off_date_time,
    car_type: carType || quote.vehicle?.type,
    provider: "duffel",
    offer_data: quote,
  });

  if (carError) {
    await supabaseAdmin.from("bookings").delete().eq("id", booking.id);
    throw new AppError(
      "Failed to save the car bookings details",
      HTTP.INTERNAL_ERROR,
      carError,
    );
  }

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: booking.id,
    action: ACTIVITY_LOGS.BOOKING_CREATED,
    new_status: BOOKINGS.PENDING_PAYMENT,
    performed_by: userId,
  });

  logger.info(`[CarServices] Booking initiated: ${bookingRef}`, {
    bookingId: booking.id,
  });

  return {
    bookingId: booking.id,
    bookingRef,
    quoteId: quote.id,
    amount: quote.total_amount,
    currency: quote.total_currency,
  };
}

// ── CONFIRM CAR BOOKING  ─────────────────────────────────────────────────────────────
async function confirmCarBooking({
  bookingId,
  userId,
  driver,
  paymentProvide = "stripe",
}) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, car_booking(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("BOoking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  if (booking.status === BOOKINGS.CONFIRMED) return { alreadyConfirmed: true };

  const carBooking = booking.car_booking?.[0];
  const quoteId = carBooking?.duffel_quote_id;

  if (!quoteId)
    throw new AppError("Car booking quote data missing", HTTP.INTERNAL_ERROR);

  const duffelBooking = await carsIntegration.createBooking({
    quoteId,
    driver,
    paymentType: "balance",
  });

  await supabaseAdmin
    .from("car_booking")
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
    performed_by: userId,
  });

  logger.info(`[CarServices] Booking confirmed: ${booking.booking_ref}`);

  return {
    bookingId,
    bookingRef: booking.booking_ref,
    duffelBookingId: duffelBooking.id,
    status: BOOKINGS.CONFIRMED,
  };
}

// ── CANCEL CAR BOOKING  ─────────────────────────────────────────────────────────────
async function cancelCarBooking(bookingId, userId) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, car_booking(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  if (booking.status === BOOKINGS.CANCELLED)
    throw new AppError("Already cancelled", HTTP.UNPROCESSABLE);

  const carBooking = booking.car_booking?.[0];
  if (carBooking?.duffel_order_id) {
    await carsIntegration.cancelBooking(carBooking.duffel_order_id);
  }

  await supabaseAdmin
    .from("bookings")
    .update({
      status: BOOKINGS.CANCELLED,
      cancelled_at: new Date().toISOString,
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

// ── GET / LIST  ─────────────────────────────────────────────────────────────
async function getBooking(bookingId, userId) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("*, car_booking(*), payments(*)")
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
    .select("*, car_booking(*)", { count: "exact" })
    .eq("user_id", userId)
    .eq("booking_type", BOOKING_TYPE.CAR)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  const { data, error, count } = await query;
  if (error)
    throw new AppError("Failed to fetch bookings", HTTP.INTERNAL_ERROR, error);
  return { bookings: data, total: count, page, limit };
}

module.exports = {
  searchCars,
  getQuoteDetail,
  initCarBooking,
  confirmCarBooking,
  cancelCarBooking,
  getBooking,
  listUserBookings,
};
