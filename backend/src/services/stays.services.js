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

// ── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Extract the full rate object from an accommodation's rooms array.
 * Duffel nests rates under accommodation.rooms[n].rates[n].
 * We return the first matching rate for a given rateId, or fall back to [0][0].
 */
function _extractRate(acc, rateId) {
  for (const room of acc?.rooms || []) {
    for (const rate of room?.rates || []) {
      if (!rateId || rate.id === rateId) return { room, rate };
    }
  }
  const room = acc?.rooms?.[0] ?? null;
  const rate = room?.rates?.[0] ?? null;
  return { room, rate };
}

/**
 * Build the go-live required price block directly from the rate object.
 * All values are returned as-is from Duffel — no modifications.
 */
function _buildPriceBlock(rate) {
  return {
    totalAmount: rate?.total_amount ?? null,
    totalCurrency: rate?.total_currency ?? null,
    baseAmount: rate?.base_amount ?? null,
    baseCurrency: rate?.base_currency ?? null,
    // BUG FIX: tax_amount and fee_amount come from rate, NOT from the
    // top-level quote object. The old code read quote.tax_amount which is
    // undefined — the quote only has them nested inside accommodation.rooms.rates.
    taxAmount: rate?.tax_amount ?? "0.00",
    taxCurrency: rate?.tax_currency ?? null,
    feeAmount: rate?.fee_amount ?? "0.00",
    feeCurrency: rate?.fee_currency ?? null,
    // due_at_accommodation must always be shown even if 0
    dueAtAccommodation: rate?.due_at_accommodation_amount ?? "0.00",
    dueAtAccommodationCurrency: rate?.due_at_accommodation_currency ?? null,
  };
}

/**
 * Build the go-live required accommodation block.
 */
function _buildAccommodationBlock(acc) {
  return {
    id: acc?.id ?? null,
    name: acc?.name ?? null,
    description: acc?.description ?? null,
    starRating: acc?.rating ?? null,
    reviewScore: acc?.review_score ?? null,
    brand: acc?.brand?.name ?? null,
    phone: acc?.phone_number ?? null,
    email: acc?.email ?? null,
    address: acc?.location?.address ?? null,
    coordinates: acc?.location?.geographic_coordinates ?? null,
    // Go-live: check_in_after_time and check_out_before_time must both be shown
    checkInInfo: {
      checkInAfterTime: acc?.check_in_information?.check_in_after_time ?? null,
      checkOutBeforeTime:
        acc?.check_in_information?.check_out_before_time ?? null,
      checkInBeforeTime:
        acc?.check_in_information?.check_in_before_time ?? null,
    },
    // Go-live: key_collection must always be shown; if null, display fallback message
    keyCollection: acc?.key_collection?.instructions
      ? { instructions: acc.key_collection.instructions }
      : {
          instructions:
            "Please contact the property directly for key collection instructions.",
        },
    amenities: acc?.amenities ?? [],
    photos: acc?.photos ?? [],
  };
}

/**
 * Build the go-live required rate details block.
 */
function _buildRateBlock(rate, room) {
  return {
    rateId: rate?.id ?? null,
    roomName: room?.name ?? null,
    boardType: rate?.board_type ?? null,
    paymentType: rate?.payment_type ?? null,
    availablePaymentMethods: rate?.available_payment_methods ?? [],
    expiresAt: rate?.expires_at ?? null,
    // Go-live: cancellation_timeline MUST be shown (select a refundable rate)
    cancellationTimeline: rate?.cancellation_timeline ?? [],
    // Go-live: conditions must be shown word-for-word, always visible by default
    conditions: rate?.conditions ?? [],
    // Go-live: benefits shown if present
    benefits: rate?.benefits ?? [],
  };
}

/**
 * Business details block — required pre and post booking per go-live criteria.
 */
function _buildBusinessBlock() {
  return {
    name: process.env.BUSINESS_NAME || "OTA Travel",
    address: process.env.BUSINESS_ADDRESS || "Your business address",
    email: process.env.BUSINESS_EMAIL || "support@yourdomain.com",
    phone: process.env.BUSINESS_PHONE || "+1-800-000-0000",
    termsUrl: process.env.BUSINESS_TERMS_URL || "https://yourdomain.com/terms",
    // Go-live: Booking.com T&C must be shown where applicable
    bookingComTermsUrl: "https://www.booking.com/content/terms.html",
  };
}

// ── SEARCH HOTELS ─────────────────────────────────────────────────────────────
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

  const hotels = (search.results || []).map(mapDuffelHotelResult);

  return {
    status: "completed",
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
  const acc = await staysIntegration.getAccommodation(accommodationId);
  return {
    id: acc.id,
    name: acc.name,
    starRating: acc.rating,
    reviewScore: acc.review_score,
    reviewCount: acc.review_count ?? null,
    brand: acc.brand?.name ?? null,
    phone: acc.phone_number ?? null,
    email: acc.email ?? null,
    // BUG FIX: old code used acc.address (undefined) and acc.geolocation (undefined).
    // Correct paths are acc.location.address and acc.location.geographic_coordinates.
    address: acc.location?.address ?? null,
    coordinates: acc.location?.geographic_coordinates ?? null,
    photos: acc.photos ?? [],
    amenities: acc.amenities ?? [],
    description: acc.description ?? null,
    checkInInfo: {
      checkInAfterTime: acc.check_in_information?.check_in_after_time ?? null,
      checkOutBeforeTime:
        acc.check_in_information?.check_out_before_time ?? null,
    },
    keyCollection: acc.key_collection?.instructions
      ? { instructions: acc.key_collection.instructions }
      : {
          instructions:
            "Please contact the property directly for key collection instructions.",
        },
    paymentInstructionSupported: acc.payment_instruction_supported ?? false,
  };
}

// ── GET HOTEL RATES ─────────────────────────────────────────────────────────────
async function getHotelRates(resultId) {
  const data = await staysIntegration.getSearchResult(resultId);
  const acc = data.accommodation;

  const rooms = (acc?.rooms || []).map((room) => ({
    name: room.name,
    beds: room.beds ?? [],
    photos: room.photos ?? [],
    rates: (room.rates || []).map((rate) => ({
      rateId: rate.id,
      expiresAt: rate.expires_at,
      name: rate.name ?? null,
      description: rate.description ?? null,
      boardType: rate.board_type,
      paymentType: rate.payment_type,
      availablePaymentMethods: rate.available_payment_methods ?? [],
      availableQuantity: rate.quantity_available ?? null,
      // Go-live price fields — all must be present even if 0
      totalAmount: rate.total_amount,
      totalCurrency: rate.total_currency,
      baseAmount: rate.base_amount,
      baseCurrency: rate.base_currency,
      taxAmount: rate.tax_amount ?? "0.00",
      taxCurrency: rate.tax_currency ?? null,
      feeAmount: rate.fee_amount ?? "0.00",
      feeCurrency: rate.fee_currency ?? null,
      dueAtAccommodation: rate.due_at_accommodation_amount ?? "0.00",
      dueAtAccommodationCurrency: rate.due_at_accommodation_currency ?? null,
      // Go-live required fields
      cancellationTimeline: rate.cancellation_timeline ?? [],
      conditions: rate.conditions ?? [],
      benefits: rate.benefits ?? [],
      paymentInstructionAllowed: rate.payment_instruction_allowed ?? false,
    })),
  }));

  return {
    resultId: data.id,
    expiresAt: data.expires_at,
    checkInDate: data.check_in_date,
    checkOutDate: data.check_out_date,
    rooms: data.rooms,
    guests: data.guests ?? [],
    accommodation: _buildAccommodationBlock(acc),
    // Flatten rooms with rates for easy frontend consumption
    roomRates: rooms,
    // Business details required pre-booking
    business: _buildBusinessBlock(),
  };
}

// ── CREATE QUOTE ─────────────────────────────────────────────────────────────
async function createQuote(rateId) {
  const quote = await staysIntegration.createQuote(rateId);
  const acc = quote.accommodation;
  const { room, rate } = _extractRate(acc, rateId);

  // Calculate nights
  const nights = Math.round(
    (new Date(quote.check_out_date) - new Date(quote.check_in_date)) /
      (1000 * 60 * 60 * 24),
  );

  return {
    quoteId: quote.id,
    checkInDate: quote.check_in_date,
    checkOutDate: quote.check_out_date,
    nights,
    rooms: quote.rooms,
    guests: quote.guests ?? [],
    // Go-live: price must come from accommodation.rooms.rates, not top-level quote
    price: _buildPriceBlock(rate),
    rate: _buildRateBlock(rate, room),
    accommodation: _buildAccommodationBlock(acc),
    business: _buildBusinessBlock(),
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

  const acc = quote.accommodation;
  const { room, rate } = _extractRate(acc, rateId);

  const bookingRef = generateBookingRef("HTL");

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from("bookings")
    .insert({
      user_id: userId,
      booking_type: BOOKING_TYPE.HOTEL,
      status: BOOKINGS.PENDING_PAYMENT,
      // BUG FIX: total_amount must come from rate.total_amount, not quote.total_amount
      total_amount: parseFloat(rate?.total_amount ?? quote.total_amount),
      currency: rate?.total_currency ?? quote.total_currency,
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
      hotel_id: hotelId || acc?.id || "unknown",
      hotel_name: hotelName || acc?.name || "Hotel",
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      num_rooms: rooms,
      num_guests: guests.length,
      guests_data: guests,
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

  const nights = Math.round(
    (new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24),
  );

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
    // ── Booking identifiers ──
    bookingId: booking.id,
    bookingRef,
    quoteId: quote.id,
    status: BOOKINGS.PENDING_PAYMENT,

    // ── Stay details ──
    numGuests: Array.isArray(guests) ? guests.length : 1,
    numRooms: rooms,
    numNights: nights,
    checkInDate,
    checkOutDate,

    // ── Go-live: price from rate, not top-level quote ──
    price: _buildPriceBlock(rate),

    // ── Go-live: rate/conditions/cancellation ──
    rate: _buildRateBlock(rate, room),

    // ── Go-live: accommodation with all required fields ──
    accommodation: _buildAccommodationBlock(acc),

    // ── Go-live: business details must be visible pre-booking ──
    business: _buildBusinessBlock(),
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

  const duffelGuests = hotelBooking?.guests_data;
  if (!duffelGuests?.length)
    throw new AppError(
      "Guest information missing. Cannot confirm booking.",
      HTTP.UNPROCESSABLE,
    );

  const duffelBooking = await staysIntegration.createBooking({
    quoteId,
    guests: duffelGuests,
    paymentType: "balance",
  });

  await Promise.all([
    supabaseAdmin
      .from("hotel_booking")
      .update({
        duffel_order_id: duffelBooking.id,
        provider_order_id: duffelBooking.id,
        duffel_reference: duffelBooking.reference,
        confirmed_at: duffelBooking.confirmed_at,
      })
      .eq("booking_id", bookingId),

    supabaseAdmin
      .from("bookings")
      .update({ status: BOOKINGS.CONFIRMED })
      .eq("id", bookingId),

    supabaseAdmin
      .from("payments")
      .update({ status: "COMPLETED", paid_at: new Date().toISOString() })
      .eq("booking_id", bookingId),

    supabaseAdmin.from("booking_logs").insert({
      booking_id: bookingId,
      action: ACTIVITY_LOGS.BOOKING_CONFIRMED,
      old_status: booking.status,
      new_status: BOOKINGS.CONFIRMED,
      message: `Duffel stays booking: ${duffelBooking.id}`,
      performed_by: userId,
    }),
  ]);

  staysIntegration
    .getPaymentInstructions(duffelBooking.id)
    .then((instructions) => {
      supabaseAdmin
        .from("hotel_booking")
        .update({ payment_instructions: instructions })
        .eq("booking_id", bookingId)
        .then(() => {});
    })
    .catch(() => {});

  logger.info(`[StayServices] Booking confirmed: ${booking.booking_ref}`);

  let paymentInstructions = null;
  try {
    paymentInstructions = await staysIntegration.getPaymentInstructions(
      duffelBooking.id,
    );
  } catch (_) {
    /* not all bookings have payment instructions */
  }

  const acc = duffelBooking.accommodation;
  const { room, rate } = _extractRate(acc);

  const nights = Math.round(
    (new Date(duffelBooking.check_out_date) -
      new Date(duffelBooking.check_in_date)) /
      (1000 * 60 * 60 * 24),
  );

  return {
    // ── Booking identifiers ──
    bookingId,
    bookingRef: booking.booking_ref,
    duffelBookingId: duffelBooking.id,
    // Go-live: this is the reference shown to the guest — it comes from Duffel (e.g. "JIUA32")
    // NOT your internal bookingRef. This is what appears on the hotel's system.
    duffelReference: duffelBooking.reference,
    confirmedAt: duffelBooking.confirmed_at,
    status: BOOKINGS.CONFIRMED,

    // ── Guest details ──
    guests: duffelBooking.guests ?? [],
    leadGuestEmail: duffelBooking.email,
    leadGuestPhone: duffelBooking.phone_number,

    // ── Stay details ──
    numGuests: hotelBooking.num_guests,
    numRooms: hotelBooking.num_rooms,
    numNights: nights,
    checkInDate: duffelBooking.check_in_date,
    checkOutDate: duffelBooking.check_out_date,

    // ── Go-live: price from rate ──
    price: _buildPriceBlock(rate),

    // ── Go-live: rate/conditions/cancellation ──
    rate: _buildRateBlock(rate, room),

    // ── Go-live: accommodation with all required fields including key_collection ──
    accommodation: _buildAccommodationBlock(acc),

    // ── Go-live: business details must be visible post-booking ──
    business: _buildBusinessBlock(),
  };
}

// ── CANCEL HOTEL BOOKING ─────────────────────────────────────────────────────────────
async function cancelHotelBooking(bookingId, userId, reason = null) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, hotel_booking(*), payments(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  if (booking.status === BOOKINGS.CANCELLED)
    throw new AppError("Booking is already cancelled", HTTP.UNPROCESSABLE);
  if (booking.status !== BOOKINGS.CONFIRMED)
    throw new AppError(
      "Only confirmed bookings can be cancelled",
      HTTP.UNPROCESSABLE,
    );

  const hotelBooking = booking.hotel_booking?.[0];
  const payment = booking.payments;

  let duffelCancellation = null;
  if (hotelBooking?.duffel_order_id) {
    duffelCancellation = await staysIntegration.cancelBooking(
      hotelBooking.duffel_order_id,
    );
  }

  // Calculate refund from cancellation timeline
  const offer = hotelBooking?.offer_data;
  const acc = offer?.accommodation;
  const { rate } = _extractRate(acc);
  const timeline = rate?.cancellation_timeline ?? [];
  const now = new Date();

  let refundAmount = 0;
  for (const entry of timeline) {
    if (new Date(entry.before) > now) {
      refundAmount = parseFloat(entry.refund_amount);
      break;
    }
  }
  const isRefundable = refundAmount > 0;
  const currency = rate?.total_currency ?? booking.currency;

  await supabaseAdmin
    .from("bookings")
    .update({
      status: BOOKINGS.CANCELLED,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
    })
    .eq("id", bookingId);

  if (payment) {
    await supabaseAdmin
      .from("payments")
      .update({
        status: isRefundable ? "REFUND_PROCESSING" : "COMPLETED",
      })
      .eq("booking_id", bookingId);
  }

  let refundRecord = null;
  if (isRefundable && payment) {
    const { data: refund } = await supabaseAdmin
      .from("refunds")
      .insert({
        booking_id: bookingId,
        payment_id: payment.id,
        payment_provider: payment.payment_provider,
        amount: refundAmount,
        currency,
        reason: reason || "Customer requested cancellation",
        status: "PROCESSING",
        requested_by: userId,
      })
      .select()
      .single();
    refundRecord = refund;
  }

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.BOOKING_CANCELLED,
    old_status: booking.status,
    new_status: BOOKINGS.CANCELLED,
    message: reason || "Cancelled by customer",
    performed_by: userId,
  });

  logger.info(`[StayService] Booking cancelled: ${booking.booking_ref}`, {
    bookingId,
    refundAmount,
    isRefundable,
  });

  return {
    bookingId,
    bookingRef: booking.booking_ref,
    status: BOOKINGS.CANCELLED,
    cancelledAt: new Date().toISOString(),
    cancellationReason: reason || null,
    refund: {
      eligible: isRefundable,
      amount: isRefundable ? refundAmount.toFixed(2) : "0.00",
      currency,
      status: isRefundable ? "PROCESSING" : "NOT_ELIGIBLE",
      refundId: refundRecord?.id || null,
      appliedPolicy:
        timeline.length > 0
          ? timeline.find((e) => new Date(e.before) > now) || null
          : null,
      message: isRefundable
        ? `Refund of ${currency} ${refundAmount.toFixed(2)} will be processed within 5-10 business days`
        : "This booking is non-refundable as the cancellation window has passed",
    },
    cancellationTimeline: timeline,
  };
}

// ── GET BOOKING ─────────────────────────────────────────────────────────────────
async function getBooking(bookingId, userId) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("*, hotel_booking(*), payments(*)")
    .eq("id", bookingId)
    .single();

  if (error || !data) throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (data.user_id !== userId) throw new AppError("Forbidden", HTTP.FORBIDDEN);

  const hotelBooking = data.hotel_booking?.[0];
  const offer = hotelBooking?.offer_data;
  const acc = offer?.accommodation;
  const { room, rate } = _extractRate(acc);
  const payment = data.payments;

  const duffelGuests = hotelBooking?.guests_data ?? [];

  const nights = Math.round(
    (new Date(hotelBooking?.check_out_date) -
      new Date(hotelBooking?.check_in_date)) /
      (1000 * 60 * 60 * 24),
  );

  return {
    bookingId: data.id,
    bookingRef: data.booking_ref,
    duffelBookingId: hotelBooking?.duffel_order_id,
    duffelQuoteId: hotelBooking?.duffel_quote_id,
    // Go-live: duffelReference is the property's reference (e.g. "JIUA32")
    duffelReference: hotelBooking?.duffel_reference ?? null,
    confirmedAt: hotelBooking?.confirmed_at ?? null,
    status: data.status,
    createdAt: data.created_at,
    updatedAt: data.updated_at,

    guests: duffelGuests,
    numGuests: hotelBooking?.num_guests,
    numRooms: hotelBooking?.num_rooms,
    numNights: nights,

    checkInDate: hotelBooking?.check_in_date,
    checkOutDate: hotelBooking?.check_out_date,

    price: _buildPriceBlock(rate),
    rate: _buildRateBlock(rate, room),
    accommodation: _buildAccommodationBlock(acc),

    payment: payment
      ? {
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          paidAt: payment.paid_at,
          method: payment.payment_method,
          stripeSessionId: payment.stripe_session_id,
        }
      : null,

    business: _buildBusinessBlock(),
  };
}

// ── LIST USER BOOKINGS ─────────────────────────────────────────────────────────────
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
  getHotelRates,
  confirmStaysBooking: confirmHotelBooking,
};
