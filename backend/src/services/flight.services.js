"use strict";

const { supabaseAdmin } = require("../config/supabase");
const logger = require("../config/logger");
const flightIntegration = require("../integrations/duffel/flight.integration");
const {
  generateBookingRef,
  mapDuffelOffer,
  mapDuffelOrder,
} = require("../helpers/booking.helper");
const { AppError } = require("../utils/AppError");
const {
  BOOKINGS,
  BOOKING_TYPE,
  HTTP,
  ACTIVITY_LOGS,
  PAGINATION,
} = require("../constants/index");

// ── SEARCH FLIGHTS ─────────────────────────────────────────────────────────────
async function searchFlights({
  origin,
  destination,
  departureDate,
  returnDate,
  adults = 1,
  children = 0,
  infants = 0,
  cabinClass = "economy",
  maxConnections,
  sortBy = "total_amount",
  maxPrice,
  maxStops,
  airlines,
}) {
  const passengers = [];
  for (let i = 0; i < adults; i++) passengers.push({ type: "adult" });
  for (let i = 0; i < children; i++) passengers.push({ type: "child" });
  for (let i = 0; i < infants; i++)
    passengers.push({ type: "infants_without_seat" });

  const slices = [{ origin, destination, departureDate }];
  if (returnDate)
    slices.push({
      origin: destination,
      destination: origin,
      departureDate: returnDate,
    });

  const offerRequest = await flightIntegration.createOfferRequest({
    slices,
    passengers,
    cabinClass,
    maxConnections,
  });

  let offers = (offerRequest.offers || []).map(mapDuffelOffer);

  if (maxPrice !== undefined)
    offers = offers.filter((o) => parseFloat(o.totalAmount) <= maxPrice);
  if (maxStops !== undefined)
    offers = offers.filter((o) => o.slices.every((s) => s.stops <= maxStops));
  if (airlines && Array.isArray(airlines) && airlines.length > 0) {
    const upperAirlines = airlines.map((a) => a.toUpperCase());
    offers = offers.filter((o) => upperAirlines.includes(o.owner?.iataCode));
  }

  if (sortBy === "total_amount")
    offers.sort(
      (a, b) => parseFloat(a.totalAmount) - parseFloat(b.totalAmount),
    );
  else if (sortBy === "stops")
    offers.sort(
      (a, b) =>
        a.slices.reduce((n, s) => n + s.stops, 0) -
        b.slices.reduce((n, s) => n + s.stops, 0),
    );
  else if (sortBy === "duration")
    offers.sort((a, b) =>
      (a.slices[0]?.duration || "").localeCompare(b.slices[0]?.duration || ""),
    );

  const allAirlines = [
    ...new Set(offers.map((o) => o.owner?.iataCode).filter(Boolean)),
  ];
  const priceRange = offers.length
    ? {
        min: Math.min(...offers.map((o) => parseFloat(o.totalAmount))),
        max: Math.max(...offers.map((o) => parseFloat(o.totalAmount))),
      }
    : null;

  return {
    offerRequestId: offerRequest.id,
    totalOffers: offers.length,
    slices,
    cabinClass,
    filters: { availableAirlines: allAirlines, priceRange },
    offers,
  };
}

// ── LIST OFFERS ────────────────────────────────────────────────────────────────
async function listOffers({
  offerRequestId,
  sortBy,
  maxPrice,
  maxStops,
  airlines,
}) {
  let offers = await flightIntegration.listOffers({
    offerRequestId,
    sort: sortBy,
  });
  offers = offers.map(mapDuffelOffer);
  if (maxPrice !== undefined)
    offers = offers.filter((o) => parseFloat(o.totalAmount) <= maxPrice);
  if (maxStops !== undefined)
    offers = offers.filter((o) => o.slices.every((s) => s.stops <= maxStops));
  if (airlines?.length) {
    const upper = airlines.map((a) => a.toUpperCase());
    offers = offers.filter((o) => upper.includes(o.owner?.iataCode));
  }
  if (sortBy === "total_amount")
    offers.sort(
      (a, b) => parseFloat(a.totalAmount) - parseFloat(b.totalAmount),
    );
  return { totalOffers: offers.length, offers };
}

// ── GET OFFER DETAILS WITH SEAT MAP ───────────────────────────────────────────
async function getOfferDetails(offerId) {
  const [offer, seatMaps] = await Promise.allSettled([
    flightIntegration.getOffer(offerId),
    flightIntegration.getSeatMap(offerId),
  ]);

  if (offer.status === "rejected") throw offer.reason;

  let seatMapData = [];
  let seatMapStatus = "available";

  if (seatMaps.status === "fulfilled") {
    seatMapData = seatMaps.value;
    if (seatMapData.length === 0) seatMapStatus = "not_available";
  } else {
    logger.warn(`[FlightService] Seat map fetch failed for offer ${offerId}:`, {
      error: seatMaps.reason?.message,
    });
    seatMapStatus = "error";
  }

  return {
    ...mapDuffelOffer(offer.value),
    seatMaps: seatMapData,
    seatMapStatus,
  };
}

// ── INIT BOOKING ───────────────────────────────────────────────────────────────
async function initFlightBooking({
  userId,
  offerId,
  passengers,
  tripType = "ONE_WAY",
}) {
  const offer = await flightIntegration.getOffer(offerId);
  if (new Date(offer.expires_at) < new Date())
    throw new AppError(
      "This flight offer has expired. Please search again.",
      HTTP.UNPROCESSABLE,
    );

  const mapped = mapDuffelOffer(offer);
  const bookingRef = generateBookingRef("FLT");
  const firstSlice = mapped.slices[0];
  const lastSlice = mapped.slices[mapped.slices.length - 1];

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from("bookings")
    .insert({
      user_id: userId,
      booking_type: BOOKING_TYPE.FLIGHT,
      status: BOOKINGS.PENDING_PAYMENT,
      total_amount: parseFloat(mapped.totalAmount),
      currency: mapped.totalCurrency,
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

  const travelersPayload = passengers.map((p) => ({
    booking_id: booking.id,
    first_name: p.firstName || p.given_name,
    last_name: p.lastName || p.family_name,
    date_of_birth: p.bornOn || p.date_of_birth,
    nationality: p.nationality || "XX",
    passport_number:
      p.passportNumber || p.passport_number || `TEMP-${Date.now()}`,
    passport_expiry: p.passportExpiry || "2030-01-01",
    gender: (p.gender || "OTHERS").toUpperCase(),
    travel_type: (p.passengerType || p.type || "ADULT")
      .toUpperCase()
      .replace("INFANT_WITHOUT_SEAT", "INFANT"),
    email: p.email || null,
    phone: p.phone || null,
  }));

  const { error: travelersError } = await supabaseAdmin
    .from("travelers")
    .insert(travelersPayload);
  if (travelersError) {
    await supabaseAdmin.from("bookings").delete().eq("id", booking.id);
    throw new AppError(
      "Failed to save the traveler details",
      HTTP.INTERNAL_ERROR,
      travelersError,
    );
  }

  const { error: flightError } = await supabaseAdmin
    .from("flight_booking")
    .insert({
      booking_id: booking.id,
      duffel_offer_id: offerId,
      origin: firstSlice.origin,
      destination: lastSlice.destination,
      departure_time: firstSlice.departureAt,
      return_date:
        mapped.slices.length > 1 ? mapped.slices[1].departureAt : null,
      trip_type: tripType,
      cabin_class: (mapped.cabinClass || "ECONOMY").toUpperCase(),
      carrier: firstSlice.segments?.[0]?.carrier || "XX",
      offer_date: new Date().toISOString(),
      provider: "duffel",
    });

  if (flightError) {
    await supabaseAdmin.from("bookings").delete().eq("id", booking.id);
    throw new AppError(
      "Failed to save flight booking details.",
      HTTP.INTERNAL_ERROR,
      flightError,
    );
  }

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: booking.id,
    action: ACTIVITY_LOGS.BOOKING_CREATED,
    new_status: BOOKINGS.PENDING_PAYMENT,
    message: `Flight booking initiated for offer ${offerId}`,
    meta_data: { offerId, tripType },
    performed_by: userId,
  });

  logger.info(`[FlightService] Booking initiated: ${bookingRef}`, {
    bookingId: booking.id,
    userId,
  });

  return {
    bookingId: booking.id,
    bookingRef,
    pricing: {
      baseAmount: mapped.baseAmount,
      baseCurrency: mapped.baseCurrency,
      taxAmount: mapped.taxAmount,
      taxCurrency: mapped.taxCurrency,
      totalAmount: mapped.totalAmount,
      currency: mapped.totalCurrency,
    },
    // Kept for backward compat
    amount: mapped.totalAmount,
    currency: mapped.totalCurrency,
    conditions: mapped.conditions,
    offerExpiresAt: offer.expires_at,
    passengerCount: travelersPayload.length,
    flight: {
      origin: firstSlice.origin,
      originName: firstSlice.originName,
      destination: lastSlice.destination,
      destinationName: lastSlice.destinationName,
      departureAt: firstSlice.departureAt,
      arrivalAt: lastSlice.arrivalAt,
      carrier: firstSlice.segments?.[0]?.carrier,
      carrierName: firstSlice.segments?.[0]?.carrierName,
      flightNumber: firstSlice.segments?.[0]?.flightNumber,
    },
  };
}

// ── CONFIRM BOOKING ────────────────────────────────────────────────────────────
async function confirmFlightBooking({
  bookingId,
  userId,
  paymentProvider = "stripe",
  selectedServices = [],
}) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, flight_booking(*), travelers(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found.", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  if (booking.status === BOOKINGS.CONFIRMED)
    return { alreadyConfirmed: true, booking };

  const flightBooking = booking.flight_booking?.[0];
  if (!flightBooking?.duffel_offer_id)
    throw new AppError("Flight booking data missing", HTTP.INTERNAL_ERROR);

  const offer = await flightIntegration.getOffer(flightBooking.duffel_offer_id);
  if (new Date(offer.expires_at) < new Date())
    throw new AppError(
      "Flight offer has expired. Please search again.",
      HTTP.UNPROCESSABLE,
    );

  const liveAmount = String(parseFloat(offer.total_amount).toFixed(2));
  const liveCurrency = offer.total_currency;

  if (parseFloat(offer.total_amount) !== parseFloat(booking.total_amount)) {
    logger.warn(
      `[FlightService] Price changed for booking ${booking.booking_ref}: stored=${booking.total_amount}, live=${offer.total_amount}`,
    );
    await supabaseAdmin
      .from("bookings")
      .update({
        total_amount: parseFloat(offer.total_amount),
        currency: liveCurrency,
      })
      .eq("id", bookingId);
  }

  const offerPassengerIds = offer.passengers.map((p) => p.id);
  const genderMap = { male: "m", female: "f", other: "m" };
  const duffelPassengers = booking.travelers.map((t, idx) => ({
    id: offerPassengerIds[idx],
    title: t.gender?.toLowerCase() === "female" ? "ms" : "mr",
    given_name: t.first_name,
    family_name: t.last_name,
    born_on: t.date_of_birth,
    gender: genderMap[t.gender?.toLowerCase()] || "m",
    email: t.email || `traveler${idx}@placeholder.com`,
    phone_number: t.phone || "+10000000000",
    passport: {
      unique_identifier: t.passport_number,
      expires_on: t.passport_expiry,
      issuing_country_code: t.nationality.substring(0, 2).toUpperCase(),
    },
  }));

  const order = await flightIntegration.createOrder({
    selectedOfferId: flightBooking.duffel_offer_id,
    passengers: duffelPassengers,
    payments: [{ type: "balance", currency: liveCurrency, amount: liveAmount }],
    metadata: { booking_id: bookingId, booking_ref: booking.booking_ref },
    services: selectedServices,
  });

  await supabaseAdmin
    .from("flight_booking")
    .update({
      duffel_order_id: order.id,
      provider_order_id: order.id,
      pnr: order.booking_reference || null,
    })
    .eq("booking_id", bookingId);

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.BOOKING_CONFIRMED,
    message: `Duffel order created: ${order.id}`,
    meta_data: { orderId: order.id, pnr: order.booking_reference },
    performed_by: userId,
  });

  logger.info(`[FlightService] Booking confirmed: ${booking.booking_ref}`, {
    orderId: order.id,
  });

  // Return the fully mapped order so the frontend gets everything
  return mapDuffelOrder(order);
}

// ── CANCEL BOOKING ─────────────────────────────────────────────────────────────
async function cancelFlightBooking(bookingId, userId) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, flight_booking(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  if ([BOOKINGS.CANCELLED, BOOKINGS.REFUNDED].includes(booking.status))
    throw new AppError("Booking is already cancelled", HTTP.UNPROCESSABLE);

  const flightBooking = booking.flight_booking?.[0];
  let refundAmount = 0;
  let refundCurrency = booking.currency;
  let refundTo = null;
  let duffelCancellationId = null;

  if (flightBooking?.duffel_order_id) {
    // Step 1: Create the cancellation quote (get refund amount)
    const cancellation = await flightIntegration.createCancellation(
      flightBooking.duffel_order_id,
    );

    // ✅ BUG FIX: Duffel returns snake_case fields — was using camelCase before
    // so refundAmount was always 0
    refundAmount = parseFloat(cancellation.refund_amount || 0);
    refundCurrency = cancellation.refund_currency || booking.currency;
    refundTo = cancellation.refund_to || null; // "arc_bsp_cash" | "voucher"
    duffelCancellationId = cancellation.id;

    // Step 2: Confirm the cancellation with Duffel (once only)
    if (duffelCancellationId) {
      await flightIntegration.confirmCancellation(duffelCancellationId);
    }
  }

  // Update DB status
  await supabaseAdmin
    .from("bookings")
    .update({
      status: BOOKINGS.CANCELLED,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: "Customer requested cancellation",
    })
    .eq("id", bookingId);

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.BOOKING_CANCELLED,
    old_status: booking.status,
    new_status: BOOKINGS.CANCELLED,
    message: "Booking cancelled by the user",
    meta_data: { refundAmount, refundCurrency, refundTo, duffelCancellationId },
    performed_by: userId,
  });

  // ── Auto-trigger Stripe refund if there's money to refund ─────────────────
  // Only attempt if a payment actually exists for this booking
  let refundResult = null;
  if (refundAmount > 0) {
    try {
      const paymentService = require("./payment.services");
      refundResult = await paymentService.initiateRefund({
        bookingId,
        userId,
        amount: refundAmount,
        reason: `Flight cancellation — Duffel refund_to: ${refundTo || "n/a"}`,
      });
    } catch (refundErr) {
      // Refund attempt failed (e.g. no payment record yet, or test mode)
      // Log it but don't fail the cancellation — the booking IS cancelled
      logger.warn(
        `[FlightService] Cancellation succeeded but auto-refund failed for booking ${bookingId}: ${refundErr.message}`,
      );
    }
  }

  const emailService = require("./email.services");
  emailService
    .sendBookingCancellation({
      userId: booking.user_id,
      bookingRef: booking.booking_ref,
      refundAmount,
      currency: refundCurrency,
    })
    .catch(() => {});

  logger.info(`[FlightServices] Booking cancelled: ${booking.booking_ref}`);

  return {
    bookingId,
    bookingRef: booking.booking_ref,
    status: BOOKINGS.CANCELLED,
    // ── Refund info ─────────────────────────────────────────────────────────
    refund: {
      amount: refundAmount,
      currency: refundCurrency,
      // refundTo tells you HOW Duffel is returning the money:
      //   "arc_bsp_cash"  → back to original payment method (most common)
      //   "voucher"       → airline credit/voucher
      //   "awaiting_payment" → was never charged so nothing to refund
      refundTo,
      // Instructions for the user based on refundTo value
      instructions: _refundInstructions(refundTo, refundAmount, refundCurrency),
      autoRefundInitiated: refundResult !== null,
      stripeRefundStatus: refundResult?.status ?? null,
    },
  };
}

// Internal helper — human-readable refund instructions based on Duffel's refund_to
function _refundInstructions(refundTo, amount, currency) {
  if (!amount || amount <= 0) {
    return "This booking is non-refundable. No refund will be issued.";
  }
  switch (refundTo) {
    case "arc_bsp_cash":
      return `A refund of ${currency} ${amount} will be returned to your original payment method within 5–10 business days.`;
    case "voucher":
      return `A travel voucher worth ${currency} ${amount} will be issued by the airline. Check your email for voucher details.`;
    case "awaiting_payment":
      return "This booking was not charged, so no refund is needed.";
    default:
      return `A refund of ${currency} ${amount} has been initiated. Please allow 5–10 business days for processing.`;
  }
}

// ── GET BOOKING ────────────────────────────────────────────────────────────────
// Returns the DB booking merged with full live Duffel order/offer data,
// including pricing breakdown, conditions, cancellation instructions, documents,
// passengers, available actions, and services.
async function getBooking(bookingId, userId) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, flight_booking(*), travelers(*), payments(*), refunds(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);

  const flightBooking = booking.flight_booking?.[0];
  let duffelData = null;

  if (flightBooking) {
    try {
      if (flightBooking.duffel_order_id) {
        // Confirmed booking — use the full order (has documents, e-tickets, etc.)
        const order = await flightIntegration.getOrder(
          flightBooking.duffel_order_id,
        );
        duffelData = mapDuffelOrder(order);
      } else if (flightBooking.duffel_offer_id) {
        // Pending payment — use the offer for pricing/conditions
        const offer = await flightIntegration.getOffer(
          flightBooking.duffel_offer_id,
        );
        duffelData = mapDuffelOffer(offer);
      }
    } catch (err) {
      logger.warn(
        `[FlightService] Could not fetch live Duffel data for booking ${bookingId}: ${err.message}`,
      );
    }
  }

  // ── Payment / refund summary ────────────────────────────────────────────────
  const payment = booking.payments?.[0] || null;
  const refund = booking.refunds?.[0] || null;

  return {
    // ── Core booking record ──────────────────────────────────────────────────
    bookingId: booking.id,
    bookingRef: booking.booking_ref,
    status: booking.status,
    bookingType: booking.booking_type,
    createdAt: booking.created_at,
    cancelledAt: booking.cancelled_at ?? null,
    cancellationReason: booking.cancellation_reason ?? null,

    // ── Pricing from DB (always present) ─────────────────────────────────────
    pricing: duffelData?.pricing ?? {
      baseAmount: null,
      baseCurrency: booking.currency,
      taxAmount: null,
      taxCurrency: booking.currency,
      totalAmount: String(booking.total_amount),
      currency: booking.currency,
    },

    // ── Cancellation & change policy ─────────────────────────────────────────
    conditions: duffelData?.conditions ?? null,

    // ── Available actions (what the user can still do) ────────────────────────
    availableActions: duffelData?.availableActions ?? [],

    // ── E-tickets and boarding passes ─────────────────────────────────────────
    documents: duffelData?.documents ?? [],

    // ── Flight details ────────────────────────────────────────────────────────
    slices: duffelData?.slices ?? [],

    // ── Passengers with seats and baggage ────────────────────────────────────
    passengers: duffelData?.passengers ?? booking.travelers ?? [],

    // ── Add-on services (seats, bags) ─────────────────────────────────────────
    services: duffelData?.services ?? [],

    // ── Airline PNR / booking reference ──────────────────────────────────────
    pnr: flightBooking?.pnr ?? null,
    duffelOrderId: flightBooking?.duffel_order_id ?? null,
    bookingReference: duffelData?.bookingReference ?? null,
    bookingReferences: duffelData?.bookingReferences ?? [],

    // ── Cancellation info (populated after cancel) ────────────────────────────
    cancellationInfo: duffelData?.cancellationInfo ?? null,

    // ── Airline-initiated changes ─────────────────────────────────────────────
    airlineInitiatedChanges: duffelData?.airlineInitiatedChanges ?? [],

    // ── Change history ────────────────────────────────────────────────────────
    changes: duffelData?.changes ?? [],

    // ── Payment / refund status ───────────────────────────────────────────────
    paymentSummary: payment
      ? {
          paymentId: payment.id,
          provider: payment.payment_provider,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          paidAt: payment.created_at,
        }
      : null,
    refundSummary: refund
      ? {
          refundId: refund.id,
          status: refund.status,
          amount: refund.amount,
          currency: refund.currency,
          reason: refund.reason,
          requestedAt: refund.created_at,
          stripeRefundId: refund.stripe_refund_id ?? null,
          // Instructions for the user
          instructions: _refundInstructions(
            null,
            refund.amount,
            refund.currency,
          ),
        }
      : null,

    // ── Duffel payment status (void window, awaiting payment) ─────────────────
    duffelPaymentStatus: duffelData?.paymentStatus ?? null,
    voidWindowEndsAt: duffelData?.voidWindowEndsAt ?? null,

    // ── Owner airline ─────────────────────────────────────────────────────────
    owner: duffelData?.owner ?? null,

    // ── Metadata ──────────────────────────────────────────────────────────────
    metadata: duffelData?.metadata ?? null,
  };
}

// ── LIST USER BOOKINGS ─────────────────────────────────────────────────────────
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
    .select("*, flight_booking(*)", { count: "exact" })
    .eq("user_id", userId)
    .eq("booking_type", BOOKING_TYPE.FLIGHT)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error)
    throw new AppError("Failed to fetch bookings", HTTP.INTERNAL_ERROR, error);

  return { bookings: data, total: count, page, limit };
}

// ── ORDER CHANGE REQUEST ───────────────────────────────────────────────────────
async function createChangeRequest({ bookingId, userId, slices }) {
  const { data: booking } = await supabaseAdmin
    .from("bookings")
    .select("*, flight_booking(*)")
    .eq("id", bookingId)
    .single();

  if (!booking) throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);

  const orderId = booking.flight_booking?.[0]?.duffel_order_id;
  if (!orderId)
    throw new AppError(
      "No Duffel order found for this booking",
      HTTP.UNPROCESSABLE,
    );

  const duffelSlices = {
    add: slices.map((s) => ({
      origin: { iata_code: s.origin },
      destination: { iata_code: s.destination },
      departure_date: s.departure_date,
      cabin_class: s.cabin_class || "economy",
    })),
    remove: slices.map((s) => ({ slice_id: s.slice_id })),
  };

  return flightIntegration.createOrderChangeRequest({
    orderId,
    slices: duffelSlices,
  });
}

module.exports = {
  searchFlights,
  listOffers,
  getOfferDetails,
  initFlightBooking,
  confirmFlightBooking,
  cancelFlightBooking,
  getBooking,
  listUserBookings,
  createChangeRequest,
};
