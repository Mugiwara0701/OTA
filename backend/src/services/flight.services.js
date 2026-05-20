"use strict";

const { supabaseAdmin } = require("../config/supabase");
const logger = require("../config/logger");
const flightIntegration = require("../integrations/duffel/flight.integration");
const {
  generateBookingRef,
  mapDuffelOffer,
} = require("../helpers/booking.helper");
const { AppError } = require("../utils/AppError");
const {
  BOOKINGS,
  BOOKING_TYPE,
  HTTP,
  ACTIVITY_LOGS,
  PAGINATION,
} = require("../constants/index");

// ── SEARCH FLIGHT ─────────────────────────────────────────────────────────────
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

  const offers = (offerRequest.offers | []).map(mapDuffelOffer);

  return {
    offerRequestId: offerRequest.id,
    totalOffers: offers.length,
    slices,
    cabinClass,
    offers,
  };
}

// ── GET OFFER DETAILS WITH SEAT MAP ─────────────────────────────────────────────────────────────
async function getOfferDetails(offerId) {
  const [offer, seatMaps] = await Promise.allSettled([
    flightIntegration.getOffer(offerId),
    flightIntegration.getSeatMap(offerId),
  ]);

  if (offer.status === "rejected") throw offer.reason;

  return {
    ...mapDuffelOffer(offer.value),
    seatMaps: seatMaps.status === "fulfilled" ? seatMaps.value : [],
  };
}

// ── INITIALIZE THE BOOKING (CREATE DB RECORDS DOES NOT CALL DUFFEL YET)  ─────────────────────────────────────────────────────────────
async function initFlightBooking({
  userId,
  offerId,
  passengers,
  tripType = "ONE_WAY",
}) {
  const offer = await flightIntegration.getOffer(offerId);
  if (new Date(offer.expires_at) < new Date()) {
    throw new AppError(
      "This flight offer has expired. Please search again.",
      HTTP.UNPROCESSABLE,
    );
  }
  const mapped = mapDuffelOffer(offer);
  const bookingRef = generateBookingRef("FLT");
  const firstSlice = mapped.slices[0];
  const lastSlice = mapped.slices[mapped.slices.length - 1];

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from("booking")
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
        mapped.sliced.length > 1 ? mapped.slices[1].departureAt : null,
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
    amount: mapped.totalAmount,
    currency: mapped.totalCurrency,
    offerExpiresAt: offer.expires_at,
    passengers: travelersPayload.length,
    flight: {
      origin: firstSlice.origin,
      destination: lastSlice.destination,
      departureAt: firstSlice.departureAt,
      carrier: firstSlice.segments?.[0]?.carrierName,
    },
  };
}

// ── CONFIRM BOOKING (CALLED AFTER PAYMENT IS CONFIRMED)   ─────────────────────────────────────────────────────────────
async function confirmFlightBooking({
  bookingId,
  userId,
  paymentProvider = "stripe",
}) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, flight_booking(*), travelers(*)")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found.", HTTP_NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  if (booking.status === BOOKINGS.CONFIRMED)
    return { alreadyConfirmed: true, booking };

  const flightBooking = booking.flight_booking?.[0];
  if (!flightBooking?.duffel_offer_id)
    throw new AppError("Flight booking data missing", HTTP.INTERNAL_ERROR);

  const duffelPassengers = booking.travelers.map((t, idx) => ({
    id: `pass_${idx}`,
    given_name: t.first_name,
    family_name: t.last_name,
    born_on: t.date_of_birth,
    gender: t.gender.toLowerCase(),
    email: t.email || `traveler${idx}@placeholder.com`,
    phone_number: t.phone || "+10000000000",
    passport: {
      unique_identifier: t.passport_number,
      expires_on: t.passport_expiry,
      issuing_country_code: t.nationality.substring(0, 2).toUpperCase(),
    },
  }));

  const payments =
    paymentProvider === "duffel"
      ? [
          {
            type: "balance",
            currency: booking.currency,
            amount: String(booking.total_amount),
          },
        ]
      : [];

  const order = await flightIntegration.createOrder({
    selectedOfferId: flightBooking.duffel_offer_id,
    passengers: duffelPassengers,
    payments,
    metadata: { booking_id: bookingId, booking_ref: booking.booking_ref },
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
    actions: ACTIVITY_LOGS.BOOKING_CONFIRMED,
    message: `Duffel order created: ${order.id}`,
    meta_data: { orderId: order.id, pnr: order.booking_reference },
    performed_by: userId,
  });

  logger.info(`[FlightService] Booking confirmed: ${booking.booking_ref}`, {
    orderId: order.id,
  });
  return {
    bookingId,
    bookingRef: booking.booking_ref,
    duffelOrderId: order.id,
    pnr: order.booking_reference,
    status: BOOKINGS.CONFIRMED,
    passengers: order.passengers,
    documents: order.documents || [],
  };
}

// ── CANCEL BOOKING  ─────────────────────────────────────────────────────────────
async function cancelFlightBooking(bookingId, userId) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, flight_booking(*")
    .eq("id", bookingId)
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  if ([BOOKINGS.CANCELLED, BOOKINGS.REFUNDED].includes(booking.status)) {
    throw new AppError("Booking is already cancelled", HTTP.UNPROCESSABLE);
  }

  const flightBooking = booking.flight_booking?.[0];
  let refundAmount = 0;
  let refundCurrency = booking.currency;

  if (flightBooking?.duffel_order_id) {
    const cancellation = await flightIntegration.createCancellation(
      flightBooking.duffel_order_id,
    );
    refundAmount = parseFloat(cancellation.refundAmount || 0);
    refundCurrency = cancellation.refundCurrency || booking.currency;

    if (cancellation.id) {
      await flightIntegration.confirmCancellation(cancellation.id);
    }
  }

  await supabaseAdmin
    .from("bookings")
    .update({
      status: BOOKINGS.CANCELLED,
      cancelled_At: new Date().toISOString(),
      cancellation_reason: "Customer requested cancellation",
    })
    .eq("id", bookingId);

  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.BOOKING_CANCELLED,
    old_status: booking.status,
    new_status: BOOKINGS.CANCELLED,
    message: "Booking cancelled by the user",
    meta_data: { refundAmount, refundCurrency },
    performed_by: userId,
  });

  logger.info(`[FlightServices] Booking cancelled: ${booking.booking_ref}`);

  return {
    bookingId,
    bookingRef: booking.booking_ref,
    status: BOOKINGS.CANCELLED,
    refundAmount,
    refundCurrency,
  };
}

// ── GET BOOKING  ─────────────────────────────────────────────────────────────
async function getBooking(bookingId, userId) {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, flight(*), travelers(*), payments(*)")
    .single();

  if (error || !booking)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);
  return booking;
}

// ── LIST USER BOOKING  ─────────────────────────────────────────────────────────────
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

// ── ORDER CHANGE REQUEST  ─────────────────────────────────────────────────────────────
async function createChangeRequest({ bookingId, userId, slices }) {
  const { data: booking } = await supabaseAdmin
    .from("bookings")
    .select("*, flight_booking(*)")
    .eq("id", bookingId)
    .single();

  if (!booking) throw new AppError("Booking not found", HTTP.NOT_FOUND);
  if (booking.user_id !== userId)
    throw new AppError("Forbidden", HTTP.FORBIDDEN);

  const orderID = booking.flight_booking?.[0]?.duffel_order_id;
  if (!orderId)
    throw new AppError(
      "No Duffel order found for this booking",
      HTTP.UNPROCESSABLE,
    );

  return flightIntegration.createOrderChangeRequest({ orderId, slices });
}

module.exports = {
  searchFlights,
  getOfferDetails,
  initFlightBooking,
  confirmFlightBooking,
  cancelFlightBooking,
  getBooking,
  listUserBookings,
  createChangeRequest,
};
