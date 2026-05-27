"use strict";

// ── BOOKING REFERENCE GENERATOR ─────────────────────────────────────────────────────────────
function generateBookingRef(type = "FLT") {
  const now = new Date();
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");

  const random = Math.random().toString(36).substring(2, 6).toUpperCase();

  return `OTA-${type}-${dateStr}-${random}`;
}

// ── DUFFEL FLIGHT OFFER MAPPER ─────────────────────────────────────────────────────────────
function mapDuffelOffer(offer) {
  const slices = (offer.slices || []).map((slice) => ({
    origin: slice.origin?.iata_code,
    originName: slice.origin?.name,
    destination: slice.destination?.iata_code,
    destinationName: slice.destination?.name,
    departureAt: slice.segments?.[0]?.departing_at,
    arrivalAt: slice.segments?.[slice.segments.length - 1]?.arriving_at,
    duration: slice.duration,
    segments: (slice.segments || []).map((seg) => ({
      id: seg.id,
      origin: seg.origin?.iata_code,
      destination: seg.destination?.iata_code,
      departureAt: seg.departing_at,
      arrivalAt: seg.arriving_at,
      carrier: seg.marketing_carrier?.iata_code,
      carrierName: seg.marketing_carrier?.name,
      flightNumber: seg.marketing_carrier_flight_number,
      aircraft: seg.aircraft?.name,
      duration: seg.duration,
    })),
    stops: (slice.segments || []).length - 1,
  }));

  const passengers = (offer.passengers || []).map((p) => ({
    id: p.id,
    type: p.type,
    baggageAllowance: (p.baggages || []).map((b) => ({
      type: b.type,
      quantity: b.quantity,
    })),
  }));

  return {
    offerId: offer.id,
    totalAmount: offer.total_amount,
    totalCurrency: offer.total_currency,
    baseAmount: offer.base_amount,
    taxAmount: offer.tax_amount,
    cabinClass: offer.cabin_class,
    refundable: offer.conditions?.refund_before_departure?.allowed ?? false,
    changeable: offer.conditions?.change_before_departure?.allowed ?? false,
    expiresAt: offer.expires_at,
    owner: {
      iataCode: offer.owner?.iata_code,
      name: offer.owner?.name,
      logoUrl: offer.owner?.logo_symbol_url,
    },
    slices,
    passengers,
    raw: offer,
  };
}

// ── DUFFEL STAYS (HOTEL) OFFER MAPPER ─────────────────────────────────────────────────────────────
function mapDuffelHotelResult(result) {
  return {
    resultId: result.id, // ← add this! needed for fetchAllRates
    accommodationsId: result.accommodation?.id,
    name: result.accommodation?.name,
    starRating: result.accommodation?.rating,
    reviewScore: result.accommodation?.review_score,
    address: result.accommodation?.address,
    location: result.accommodation?.geolocation,
    thumbnail: result.accommodation?.photos?.[0]?.url,
    amenities: result.accommodation?.amenities || [],
    checkInDate: result.check_in_date,
    checkOutDate: result.check_out_date,
    // Cheapest rate summary from search — flat fields, not nested
    cheapestRate: result.cheapest_rate_total_amount
      ? {
          totalAmount: result.cheapest_rate_total_amount,
          currency: result.cheapest_rate_currency,
        }
      : null,
    // rates array is empty at search stage — call /stays/search_results/{resultId}/actions/fetch_all_rates to get them
    rooms: [],
  };
}

function mapDuffelRatePlan(rate) {
  return {
    rateId: rate.id,
    roomType: rate.accommodation_area?.name || rate.description,
    totalAmount: rate.total_amount,
    totalCurrency: rate.total_currency,
    cancellationTimeLine: rate.cancellation_timeline,
    boardType: rate.board_type,
    availableRooms: rate.available_quantity,
  };
}

// ── DUFFEL CAR RENTAL SEARCH RESULT MAPPER ─────────────────────────────────────────────────────────────
function mapDuffelCarResult(result) {
  return {
    quoteId: result.id,
    carType: result.vehicle?.type,
    carCategory: result.vehicle?.category,
    make: result.vehicle?.make,
    model: result.vehicle?.model,
    seats: result.vehicle?.passenger_quantity,
    doors: result.vehicle?.door_count,
    transmission: result.vehicle?.transmission,
    airConditioned: result.vehicle?.air_conditioning,
    fuelPolicy: result.conditions?.fuel_policy,
    unlimitedMileage: result.conditions?.unlimited_mileage,
    pickupLocation: result.pickup_location,
    dropoffLocation: result.drop_off_locations,
    pickupAt: result.pick_up_date_time,
    dropoffAt: result.drop_off_date_time,
    totalAmount: result.total_amount,
    totalCurrency: result.total_currency,
    supplier: result.supplier?.name,
    photos: result.vehicle?.photos || [],
    includedExtras: result.included_services || [],
  };
}

// ── DURATION FORMATTER ─────────────────────────────────────────────────────────────
function formatDuration(isoDuration) {
  if (!isoDuration) return null;
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return isoDuration;
  const h = match[1] ? `${match[1]}h` : "";
  const m = match[2] ? `${match[2]}m` : "";
  return [h, m].filter(Boolean).join(" ");
}

// ── BUILD PAGINATION META ─────────────────────────────────────────────────────────────
function buildMeta(data = {}) {
  return { ...data, timestamp: new Date().toISOString() };
}

// ── DUFFEL ERROR NORMALIZER ─────────────────────────────────────────────────────────────
function normalizeDuffelError(err) {
  const { AppError } = require("../utils/AppError");
  const { HTTP } = require("../constants/index");

  const status = err?.response?.status || err?.statusCode;
  const duffelMessage =
    err?.errors?.[0].message || err?.message || "Duffel API ERROR";

  const map = {
    400: [HTTP.BAD_REQUEST, duffelMessage],
    401: [
      HTTP.BAD_GATEWAY,
      "Duffel authentication failed — check DUFFEL_ACCESS_TOKEN",
    ],
    404: [HTTP.NOT_FOUND, duffelMessage],
    422: [HTTP.UNPROCESSABLE, duffelMessage],
    429: [
      HTTP.TOO_MANY_REQUEST,
      "Duffel rate limit reached — please retry shortly",
    ],
    500: [HTTP.BAD_GATEWAY, "Duffel service error — please try again"],
    502: [HTTP.BAD_GATEWAY, "Duffel gateway error"],
  };
  const [code, message] = map[status] || [HTTP.BAD_GATEWAY, duffelMessage];
  return new AppError(message, code, { duffelErrors: err?.errors });
}

module.exports = {
  generateBookingRef,
  mapDuffelOffer,
  mapDuffelHotelResult,
  mapDuffelRatePlan,
  mapDuffelCarResult,
  formatDuration,
  buildMeta,
  normalizeDuffelError,
};
