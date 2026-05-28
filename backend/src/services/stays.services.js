"use strict";

const { supabaseAdmin } = require("../config/supabase");
const logger = require("../config/logger");
const staysIntegration = require("../integrations/duffel/stays.integration");
const {
  generateBookingRef,
  mapDuffelHotelResult,
  mapDuffelRatePlan,
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
  // search() returns all results directly — no polling needed
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
    checkInDate: quote.check_in_date,
    checkOutDate: quote.check_out_date,
    rooms: quote.rooms,
    // ── Price breakdown (as-is from Duffel, no modifications) ──
    totalAmount: quote.total_amount,
    totalCurrency: quote.total_currency,
    baseAmount: quote.base_amount ?? null,
    baseCurrency: quote.base_currency ?? null,
    taxAmount: quote.tax_amount ?? null,
    taxCurrency: quote.tax_currency ?? null,
    feeAmount: quote.fee_amount ?? null,
    feeCurrency: quote.fee_currency ?? null,
    dueAtAccommodation: quote.due_at_accommodation_amount ?? null,
    dueAtAccommodationCurrency: quote.due_at_accommodation_currency ?? null,
    // ── Rate & accommodation details ──
    boardType: quote.accommodation?.rooms?.[0]?.rates?.[0]?.board_type ?? null,
    cancellationTimeline:
      quote.accommodation?.rooms?.[0]?.rates?.[0]?.cancellation_timeline ?? [],
    conditions: quote.accommodation?.rooms?.[0]?.rates?.[0]?.conditions ?? [],
    paymentType:
      quote.accommodation?.rooms?.[0]?.rates?.[0]?.payment_type ?? null,
    accommodation: {
      id: quote.accommodation?.id,
      name: quote.accommodation?.name,
      address: quote.accommodation?.location?.address ?? null,
      coordinates:
        quote.accommodation?.location?.geographic_coordinates ?? null,
      checkInInfo: quote.accommodation?.check_in_information ?? null,
    },
  };
}

async function getHotelRates(resultId) {
  const data = await staysIntegration.getSearchResult(resultId);
  const acc = data.accommodation;

  const rooms = (acc?.rooms || []).map((room) => ({
    name: room.name,
    beds: room.beds || [],
    photos: room.photos || [],
    rates: (room.rates || []).map((rate) => ({
      rateId: rate.id,
      expiresAt: rate.expires_at,
      // ── Price breakdown (as-is from Duffel, no modifications) ──
      totalAmount: rate.total_amount,
      totalCurrency: rate.total_currency,
      baseAmount: rate.base_amount,
      baseCurrency: rate.base_currency,
      taxAmount: rate.tax_amount ?? null,
      taxCurrency: rate.tax_currency ?? null,
      feeAmount: rate.fee_amount ?? null,
      feeCurrency: rate.fee_currency ?? null,
      dueAtAccommodation: rate.due_at_accommodation_amount ?? null,
      dueAtAccommodationCurrency: rate.due_at_accommodation_currency ?? null,
      // ── Rate details ──
      boardType: rate.board_type,
      paymentType: rate.payment_type,
      availablePaymentMethods: rate.available_payment_methods || [],
      availableQuantity: rate.quantity_available ?? null,
      cancellationTimeline: rate.cancellation_timeline || [],
      conditions: rate.conditions || [],
      paymentInstructionAllowed: rate.payment_instruction_allowed,
    })),
  }));

  return {
    resultId: data.id,
    expiresAt: data.expires_at,
    accommodationsId: acc?.id,
    name: acc?.name,
    description: acc?.description || null,
    starRating: acc?.rating,
    reviewScore: acc?.review_score,
    brand: acc?.brand?.name || null,
    phone: acc?.phone_number || null,
    email: acc?.email || null,
    address: acc?.location?.address || null,
    coordinates: acc?.location?.geographic_coordinates || null,
    checkInInfo: acc?.check_in_information || null,
    keyCollection: acc?.key_collection || null,
    amenities: acc?.amenities || [],
    photos: acc?.photos || [],
    checkInDate: data.check_in_date,
    checkOutDate: data.check_out_date,
    rooms,
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

  const nights = Math.round(
    (new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24),
  );

  const room = quote.accommodation?.rooms?.[0];
  const rate = room?.rates?.[0];

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
    numGuests: guests,
    numRooms: rooms,
    numNights: nights,
    checkInDate,
    checkOutDate,

    // ── Accommodation ──
    hotelId: hotelId || quote.accommodation?.id,
    hotelName: hotelName || quote.accommodation?.name,
    address: quote.accommodation?.location?.address ?? null,
    coordinates: quote.accommodation?.location?.geographic_coordinates ?? null,
    checkInInfo: {
      checkInAfterTime:
        quote.accommodation?.check_in_information?.check_in_after_time ?? null,
      checkOutBeforeTime:
        quote.accommodation?.check_in_information?.check_out_before_time ??
        null,
    },
    keyCollection: quote.accommodation?.key_collection
      ? { instructions: quote.accommodation.key_collection.instructions }
      : {
          instructions:
            "Please contact the property directly for key collection instructions.",
        },

    // ── Price breakdown (as-is from Duffel, no modifications) ──
    totalAmount: quote.total_amount,
    currency: quote.total_currency,
    baseAmount: quote.base_amount ?? null,
    baseCurrency: quote.base_currency ?? null,
    taxAmount: quote.tax_amount ?? null,
    taxCurrency: quote.tax_currency ?? null,
    feeAmount: quote.fee_amount ?? null,
    feeCurrency: quote.fee_currency ?? null,
    dueAtAccommodation: quote.due_at_accommodation_amount ?? null,
    dueAtAccommodationCurrency: quote.due_at_accommodation_currency ?? null,

    // ── Rate details ──
    boardType: rate?.board_type ?? null,
    paymentType: rate?.payment_type ?? null,
    cancellationTimeline: rate?.cancellation_timeline ?? [],
    conditions: rate?.conditions ?? [],

    // ── Business details ──
    business: {
      name: process.env.BUSINESS_NAME || "OTA Travel",
      address: process.env.BUSINESS_ADDRESS || "Your business address",
      email: process.env.BUSINESS_EMAIL || "support@yourdomain.com",
      phone: process.env.BUSINESS_PHONE || "+1-800-000-0000",
      termsUrl:
        process.env.BUSINESS_TERMS_URL || "https://yourdomain.com/terms",
      bookingComTermsUrl: "https://www.booking.com/content/terms.html",
    },
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
      duffel_reference: duffelBooking.reference, // ← property's booking reference
      confirmed_at: duffelBooking.confirmed_at, // ← Duffel confirmation datetime
    })
    .eq("booking_id", bookingId);

  await supabaseAdmin
    .from("bookings")
    .update({ status: BOOKINGS.CONFIRMED })
    .eq("id", bookingId);

  await supabaseAdmin
    .from("payments")
    .update({ status: "COMPLETED", paid_at: new Date().toISOString() })
    .eq("booking_id", bookingId);

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

  const acc = duffelBooking.accommodation;
  const room = acc?.rooms?.[0];
  const rate = room?.rates?.[0];

  // calculate nights
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
    duffelReference: duffelBooking.reference, // ← property's reference ✅
    confirmedAt: duffelBooking.confirmed_at, // property's own reference
    status: BOOKINGS.CONFIRMED,

    // ── Guest details ──
    guests: duffelBooking.guests || [],
    leadGuestEmail: duffelBooking.email,
    leadGuestPhone: duffelBooking.phone_number,

    // ── Stay details ──
    numGuests: hotelBooking.num_guests,
    numRooms: hotelBooking.num_rooms,
    numNights: nights,
    checkInDate: duffelBooking.check_in_date,
    checkOutDate: duffelBooking.check_out_date,

    // ── Accommodation ──
    hotelName: acc?.name ?? hotelBooking.hotel_name,
    address: acc?.location?.address ?? null,
    coordinates: acc?.location?.geographic_coordinates ?? null,
    checkInInfo: {
      checkInAfterTime: acc?.check_in_information?.check_in_after_time ?? null,
      checkOutBeforeTime:
        acc?.check_in_information?.check_out_before_time ?? null,
    },
    keyCollection: acc?.key_collection
      ? { instructions: acc.key_collection.instructions }
      : {
          instructions:
            "Please contact the property directly for key collection instructions.",
        },
    amenities: acc?.amenities || [],
    photos: acc?.photos || [],

    // ── Price breakdown (as-is from Duffel) ──
    totalAmount: rate?.total_amount ?? null,
    currency: rate?.total_currency ?? null,
    baseAmount: rate?.base_amount ?? null,
    taxAmount: rate?.tax_amount ?? null,
    feeAmount: rate?.fee_amount ?? null,
    dueAtAccommodation: rate?.due_at_accommodation_amount ?? null,
    dueAtAccommodationCurrency: rate?.due_at_accommodation_currency ?? null,

    // ── Rate details ──
    boardType: rate?.board_type ?? null,
    paymentType: rate?.payment_type ?? null,
    cancellationTimeline: rate?.cancellation_timeline ?? [],
    conditions: rate?.conditions ?? [],

    // ── Payment instructions (if applicable) ──
    paymentInstructions,

    // ── Business details ──
    business: {
      name: process.env.BUSINESS_NAME || "OTA Travel",
      address: process.env.BUSINESS_ADDRESS || "Your business address",
      email: process.env.BUSINESS_EMAIL || "support@ftechiz.com",
      phone: process.env.BUSINESS_PHONE || "+91-XXXXXXXXXX",
      termsUrl:
        process.env.BUSINESS_TERMS_URL || "https://yourdomain.com/terms",
      bookingComTermsUrl: "https://www.booking.com/content/terms.html",
    },
  };
}

// ── CANCEL HOTEL BOOKING ─────────────────────────────────────────────────────────────
async function cancelHotelBooking(bookingId, userId, reason = null) {
  // ── 1. Fetch booking ──────────────────────────────────────────────
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

  // ── 2. Cancel on Duffel ───────────────────────────────────────────
  let duffelCancellation = null;
  if (hotelBooking?.duffel_order_id) {
    duffelCancellation = await staysIntegration.cancelBooking(
      hotelBooking.duffel_order_id,
    );
  }

  // ── 3. Calculate refund amount from cancellation timeline ─────────
  const offer = hotelBooking?.offer_data;
  const rate = offer?.accommodation?.rooms?.[0]?.rates?.[0];
  const timeline = rate?.cancellation_timeline || [];
  const now = new Date();

  let refundAmount = 0;
  // Find applicable refund from timeline — last entry whose `before` is in the future
  for (const entry of timeline) {
    if (new Date(entry.before) > now) {
      refundAmount = parseFloat(entry.refund_amount);
      break;
    }
  }
  // If no timeline or all entries passed — non-refundable
  const isRefundable = refundAmount > 0;
  const currency = offer?.total_currency || booking.currency;

  // ── 4. Update bookings table ──────────────────────────────────────
  await supabaseAdmin
    .from("bookings")
    .update({
      status: BOOKINGS.CANCELLED,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
    })
    .eq("id", bookingId);

  // ── 5. Update payments table ──────────────────────────────────────
  if (payment) {
    await supabaseAdmin
      .from("payments")
      .update({
        status: isRefundable ? "REFUND_PROCESSING" : "COMPLETED",
      })
      .eq("booking_id", bookingId);
  }

  // ── 6. Create refund record ───────────────────────────────────────
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

  // ── 7. Log it ─────────────────────────────────────────────────────
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

  // ── 8. Return ─────────────────────────────────────────────────────
  return {
    bookingId,
    bookingRef: booking.booking_ref,
    status: BOOKINGS.CANCELLED,
    cancelledAt: new Date().toISOString(),
    cancellationReason: reason || null,

    // ── Refund details ──
    refund: {
      eligible: isRefundable,
      amount: isRefundable ? refundAmount.toFixed(2) : "0.00",
      currency,
      status: isRefundable ? "PROCESSING" : "NOT_ELIGIBLE",
      refundId: refundRecord?.id || null,
      // Show which timeline entry applied
      appliedPolicy:
        timeline.length > 0
          ? timeline.find((e) => new Date(e.before) > now) || null
          : null,
      message: isRefundable
        ? `Refund of ${currency} ${refundAmount.toFixed(2)} will be processed within 5-10 business days`
        : "This booking is non-refundable as the cancellation window has passed",
    },

    // ── Full cancellation timeline for reference ──
    cancellationTimeline: timeline,
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

  const hotelBooking = data.hotel_booking?.[0];
  const offer = hotelBooking?.offer_data;
  const acc = offer?.accommodation;
  const rate = acc?.rooms?.[0]?.rates?.[0];
  const payment = data.payments;

  // fetch guest names from Duffel booking
  let duffelGuests = [];
  try {
    const duffelBooking = await staysIntegration.getBooking(
      hotelBooking?.duffel_order_id,
    );
    duffelGuests = duffelBooking?.guests || [];
  } catch (_) {
    /* ignore if not found */
  }

  const nights = Math.round(
    (new Date(hotelBooking?.check_out_date) -
      new Date(hotelBooking?.check_in_date)) /
      (1000 * 60 * 60 * 24),
  );

  return {
    // ── Booking identifiers ──
    bookingId: data.id,
    bookingRef: data.booking_ref,
    duffelBookingId: hotelBooking?.duffel_order_id,
    duffelQuoteId: hotelBooking?.duffel_quote_id,
    duffelReference: hotelBooking?.duffel_reference ?? null, // ← add this
    confirmedAt: hotelBooking?.confirmed_at ?? null,
    status: data.status,
    createdAt: data.created_at,
    updatedAt: data.updated_at,

    // ── Guest details ──
    guests: duffelGuests,
    numGuests: hotelBooking?.num_guests,
    numRooms: hotelBooking?.num_rooms,
    numNights: nights,

    // ── Stay details ──
    hotelId: hotelBooking?.hotel_id,
    hotelName: hotelBooking?.hotel_name,
    checkInDate: hotelBooking?.check_in_date,
    checkOutDate: hotelBooking?.check_out_date,
    address: acc?.location?.address ?? null,
    coordinates: acc?.location?.geographic_coordinates ?? null,
    checkInInfo: {
      checkInAfterTime: acc?.check_in_information?.check_in_after_time ?? null,
      checkOutBeforeTime:
        acc?.check_in_information?.check_out_before_time ?? null,
    },
    keyCollection: acc?.key_collection
      ? { instructions: acc.key_collection.instructions }
      : {
          instructions:
            "Please contact the property directly for key collection instructions.",
        },
    amenities: acc?.amenities || [],
    photos: acc?.photos || [],

    // ── Price breakdown (as-is from Duffel) ──
    totalAmount: offer?.total_amount ?? null,
    currency: offer?.total_currency ?? null,
    baseAmount: offer?.base_amount ?? null,
    taxAmount: rate?.tax_amount ?? null,
    taxCurrency: rate?.tax_currency ?? null,
    feeAmount: rate?.fee_amount ?? null,
    feeCurrency: rate?.fee_currency ?? null,
    dueAtAccommodation: offer?.due_at_accommodation_amount ?? null,
    dueAtAccommodationCurrency: offer?.due_at_accommodation_currency ?? null,
    depositAmount: offer?.deposit_amount ?? null,

    // ── Rate details ──
    boardType: rate?.board_type ?? null,
    paymentType: rate?.payment_type ?? null,
    cancellationTimeline: rate?.cancellation_timeline ?? [],
    conditions: rate?.conditions ?? [],

    // ── Payment status ──
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

    // ── Business details ──
    business: {
      name: process.env.BUSINESS_NAME || "OTA Travel",
      address: process.env.BUSINESS_ADDRESS || "Your business address",
      email: process.env.BUSINESS_EMAIL || "support@ftechiz.com",
      phone: process.env.BUSINESS_PHONE || "+91-XXXXXXXXXX",
      termsUrl:
        process.env.BUSINESS_TERMS_URL || "https://yourdomain.com/terms",
      bookingComTermsUrl: "https://www.booking.com/content/terms.html",
    },
  };
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
  getHotelRates,
};
