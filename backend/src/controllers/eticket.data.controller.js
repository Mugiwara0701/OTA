"use strict";

/**
 * getETicketData
 *
 * GET /api/v1/flights/bookings/:bookingId/eticket/data
 *
 * Returns a single, flat JSON object shaped for the mobile/web app
 * to render the e-ticket natively — no PDF processing required on the client.
 *
 * Two modes:
 *   • Full mode   — booking has a duffel_order_id → fetch live data from Duffel
 *   • Local mode  — no duffel_order_id (test / manual inserts) → build from DB only
 */

const { asyncHandler, AppError } = require("../utils/AppError");
const { supabaseAdmin } = require("../config/supabase");
const flightIntegration = require("../integrations/duffel/flight.integration");
const { mapDuffelOrder } = require("../helpers/booking.helper");
const { HTTP, BOOKINGS } = require("../constants/index");
const { sendSuccess } = require("../helpers/helper.response");
const { decrypt } = require("../config/crypto.config");

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return null;
  return new Date(iso).toISOString();
}

function fmtTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtDuration(dur) {
  if (!dur) return null;
  const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return dur;
  const h = m[1] ? `${m[1]}h` : "";
  const mn = m[2] ? `${m[2]}m` : "";
  return [h, mn].filter(Boolean).join(" ");
}

// Build a lookup: duffel passenger id → traveler row (for name/passport data)
function buildPassengerLookup(orderPassengers = [], travelers = []) {
  return orderPassengers.reduce((map, p, idx) => {
    map[p.id] = {
      ...p,
      passportNumber: decrypt(travelers[idx]?.passport_number) ?? null,
      nationality: travelers[idx]?.nationality ?? null,
    };
    return map;
  }, {});
}

// ── Safe decrypt: returns plaintext if the value isn't encrypted ──────────────
function safeDecrypt(value) {
  if (!value) return null;
  try {
    return decrypt(value) ?? value;
  } catch {
    return value; // plaintext test data — return as-is
  }
}

// ── Build a minimal journey from local DB flight_booking row ──────────────────
// Used when there is no duffel_order_id (test / manually-inserted bookings).
function buildLocalJourneys(flightBooking) {
  const origin = flightBooking.origin ?? null;
  const destination = flightBooking.destination ?? null;
  const carrier = flightBooking.carrier ?? null;
  const cabinClass = flightBooking.cabin_class ?? null;
  const departureTime = flightBooking.departure_time ?? null;
  const returnDate = flightBooking.return_date ?? null;
  const tripType = (flightBooking.trip_type ?? "ONE_WAY").toUpperCase();

  const outbound = {
    journeyIndex: 0,
    journeyLabel: tripType === "ROUND_TRIP" ? "Outbound" : "Flight",
    origin: { iataCode: origin, cityName: null, airportName: null },
    destination: { iataCode: destination, cityName: null, airportName: null },
    departure: fmtDate(departureTime),
    departureIso: fmt(departureTime),
    arrival: null,
    arrivalIso: null,
    totalDuration: null,
    connections: 0,
    segments: [
      {
        segmentId: "local-seg-0",
        flightNumber: carrier ?? "--",
        operatingFlightNumber: carrier ?? "--",
        airline: {
          iataCode: carrier,
          name: carrier,
          logoUrl: null,
          logoLockup: null,
        },
        operatingAirline: null,
        aircraft: null,
        origin: {
          iataCode: origin,
          cityName: null,
          airportName: null,
          terminal: null,
          countryCode: null,
          timeZone: null,
        },
        destination: {
          iataCode: destination,
          cityName: null,
          airportName: null,
          terminal: null,
          countryCode: null,
          timeZone: null,
        },
        departure: {
          isoUtc: fmt(departureTime),
          time: fmtTime(departureTime),
          date: fmtDate(departureTime),
          timestamp: departureTime,
        },
        arrival: {
          isoUtc: null,
          time: null,
          date: null,
          timestamp: null,
        },
        duration: null,
        durationRaw: null,
        stops: [],
        passengerInfo: [],
        cabinClass: cabinClass,
      },
    ],
  };

  const journeys = [outbound];

  if (tripType === "ROUND_TRIP" && returnDate) {
    journeys.push({
      journeyIndex: 1,
      journeyLabel: "Return",
      origin: { iataCode: destination, cityName: null, airportName: null },
      destination: { iataCode: origin, cityName: null, airportName: null },
      departure: fmtDate(returnDate),
      departureIso: fmt(returnDate),
      arrival: null,
      arrivalIso: null,
      totalDuration: null,
      connections: 0,
      segments: [
        {
          segmentId: "local-seg-1",
          flightNumber: carrier ?? "--",
          operatingFlightNumber: carrier ?? "--",
          airline: {
            iataCode: carrier,
            name: carrier,
            logoUrl: null,
            logoLockup: null,
          },
          operatingAirline: null,
          aircraft: null,
          origin: {
            iataCode: destination,
            cityName: null,
            airportName: null,
            terminal: null,
            countryCode: null,
            timeZone: null,
          },
          destination: {
            iataCode: origin,
            cityName: null,
            airportName: null,
            terminal: null,
            countryCode: null,
            timeZone: null,
          },
          departure: {
            isoUtc: fmt(returnDate),
            time: fmtTime(returnDate),
            date: fmtDate(returnDate),
            timestamp: returnDate,
          },
          arrival: {
            isoUtc: null,
            time: null,
            date: null,
            timestamp: null,
          },
          duration: null,
          durationRaw: null,
          stops: [],
          passengerInfo: [],
          cabinClass: cabinClass,
        },
      ],
    });
  }

  return journeys;
}

// ── Build passenger list from local travelers rows ────────────────────────────
function buildLocalPassengers(travelers = []) {
  return travelers.map((t, idx) => ({
    passengerId: `local-pax-${idx}`,
    type: (t.travel_type ?? "ADULT").toLowerCase(),
    title: null,
    firstName: t.first_name ?? null,
    lastName: t.last_name ?? null,
    dateOfBirth: t.date_of_birth ?? null,
    gender: t.gender ?? null,
    passportNumber: safeDecrypt(t.passport_number),
    nationality: t.nationality ?? null,
    email: t.email ?? null,
    ticketNumbers: [],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

const getETicketData = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;

  // ── 1. Load booking + relations ───────────────────────────────────────────
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("*, flight_booking(*), travelers(*), payments(*)")
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
  if (!flightBooking) {
    throw new AppError(
      "Flight details not found for this booking",
      HTTP.NOT_FOUND,
    );
  }

  // ── 3. Load user profile ──────────────────────────────────────────────────
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("first_name, last_name, email, phone")
    .eq("id", booking.user_id)
    .single();

  // ── 4. Payment info ───────────────────────────────────────────────────────
  const payment = booking.payments?.[0] ?? null;

  let journeys, passengers, order;

  if (flightBooking.duffel_order_id) {
    // ── FULL MODE: fetch live data from Duffel ──────────────────────────────
    const rawOrder = await flightIntegration.getOrder(
      flightBooking.duffel_order_id,
    );
    order = mapDuffelOrder(rawOrder);

    const passengerLookup = buildPassengerLookup(
      order.passengers || [],
      booking.travelers || [],
    );

    journeys = (order.slices || []).map((slice, sliceIdx) => {
      const segments = (slice.segments || []).map((seg) => {
        const seats = (seg.passengers || []).map((sp) => {
          const pax = passengerLookup[sp.passengerId] || {};
          return {
            passengerId: sp.passengerId,
            passengerName:
              pax.givenName && pax.familyName
                ? `${pax.givenName} ${pax.familyName}`
                : null,
            seat: sp.seat?.designator ?? null,
            seatName: sp.seat?.name ?? null,
            cabinClass: sp.cabinClass ?? null,
            cabinClassName: sp.cabinClassMarketingName ?? null,
            baggages: sp.baggages ?? [],
          };
        });

        return {
          segmentId: seg.id,
          flightNumber: `${seg.marketingCarrier?.iataCode ?? ""}${seg.marketingCarrierFlightNumber ?? ""}`,
          operatingFlightNumber: `${seg.operatingCarrier?.iataCode ?? ""}${seg.operatingCarrierFlightNumber ?? ""}`,
          airline: {
            iataCode: seg.marketingCarrier?.iataCode ?? null,
            name: seg.marketingCarrier?.name ?? null,
            logoUrl: seg.marketingCarrier?.logoUrl ?? null,
            logoLockup: seg.marketingCarrier?.logoLockupUrl ?? null,
          },
          operatingAirline:
            seg.operatingCarrier?.iataCode !== seg.marketingCarrier?.iataCode
              ? {
                  iataCode: seg.operatingCarrier?.iataCode ?? null,
                  name: seg.operatingCarrier?.name ?? null,
                }
              : null,
          aircraft: seg.aircraft?.name ?? null,
          origin: {
            iataCode: seg.origin?.iataCode ?? null,
            cityName: seg.origin?.cityName ?? null,
            airportName: seg.origin?.name ?? null,
            terminal: seg.originTerminal ?? null,
            countryCode: seg.origin?.countryCode ?? null,
            timeZone: seg.origin?.timeZone ?? null,
          },
          destination: {
            iataCode: seg.destination?.iataCode ?? null,
            cityName: seg.destination?.cityName ?? null,
            airportName: seg.destination?.name ?? null,
            terminal: seg.destinationTerminal ?? null,
            countryCode: seg.destination?.countryCode ?? null,
            timeZone: seg.destination?.timeZone ?? null,
          },
          departure: {
            isoUtc: fmt(seg.departingAt),
            time: fmtTime(seg.departingAt),
            date: fmtDate(seg.departingAt),
            timestamp: seg.departingAt,
          },
          arrival: {
            isoUtc: fmt(seg.arrivingAt),
            time: fmtTime(seg.arrivingAt),
            date: fmtDate(seg.arrivingAt),
            timestamp: seg.arrivingAt,
          },
          duration: fmtDuration(seg.duration),
          durationRaw: seg.duration,
          stops: (seg.stops || []).map((st) => ({
            airport: { iataCode: st.airport?.iataCode, name: st.airport?.name },
            arrivingAt: fmt(st.arrivingAt),
            departingAt: fmt(st.departingAt),
            duration: fmtDuration(st.duration),
          })),
          passengerInfo: seats,
        };
      });

      return {
        journeyIndex: sliceIdx,
        journeyLabel:
          sliceIdx === 0
            ? "Outbound"
            : sliceIdx === 1
              ? "Return"
              : `Leg ${sliceIdx + 1}`,
        origin: {
          iataCode: slice.origin?.iataCode ?? null,
          cityName: slice.origin?.cityName ?? null,
          airportName: slice.origin?.name ?? null,
        },
        destination: {
          iataCode: slice.destination?.iataCode ?? null,
          cityName: slice.destination?.cityName ?? null,
          airportName: slice.destination?.name ?? null,
        },
        departure: fmtDate(slice.departureAt),
        departureIso: fmt(slice.departureAt),
        arrival: fmtDate(slice.arrivalAt),
        arrivalIso: fmt(slice.arrivalAt),
        totalDuration: fmtDuration(slice.duration),
        connections: slice.connections ?? 0,
        segments,
      };
    });

    passengers = (order.passengers || []).map((p, idx) => {
      const traveler = booking.travelers?.[idx] ?? {};
      return {
        passengerId: p.id,
        type: p.type,
        title: p.title ?? null,
        firstName: p.givenName,
        lastName: p.familyName,
        dateOfBirth: p.bornOn ?? traveler.date_of_birth ?? null,
        gender: p.gender ?? traveler.gender ?? null,
        passportNumber: safeDecrypt(traveler.passport_number),
        nationality: traveler.nationality ?? null,
        email: p.email ?? traveler.email ?? null,
        ticketNumbers: (order.documents || [])
          .filter(
            (d) =>
              d.type === "electronic_ticket" && d.passengerIds.includes(p.id),
          )
          .map((d) => d.uniqueIdentifier),
      };
    });
  } else {
    // ── LOCAL MODE: build from DB only (test / manual bookings) ────────────
    order = { bookingReferences: [], conditions: null };
    journeys = buildLocalJourneys(flightBooking);
    passengers = buildLocalPassengers(booking.travelers || []);
  }

  // ── 8. Compose final response ─────────────────────────────────────────────
  const eticket = {
    bookingId: booking.id,
    bookingRef: booking.booking_ref,
    status: booking.status,
    issuedAt: fmt(booking.created_at),

    pnr: flightBooking.pnr ?? order.bookingReference ?? null,
    allReferences: (order.bookingReferences || []).map((br) => ({
      reference: br.reference,
      airlineName: br.carrier?.name ?? null,
      airlineCode: br.carrier?.iataCode ?? null,
    })),

    booker: {
      firstName: user?.first_name ?? null,
      lastName: user?.last_name ?? null,
      email: user?.email ?? null,
      phone: user?.phone ?? null,
    },

    journeys,
    passengers,

    payment: {
      totalAmount: parseFloat(booking.total_amount).toFixed(2),
      currency: booking.currency,
      status: payment?.status ?? "COMPLETED",
      paidAt:
        payment?.paid_at ?? payment?.created_at ?? fmt(booking.created_at),
      provider: payment?.payment_provider ?? null,
    },

    conditions: order.conditions ?? null,

    qrPayload: JSON.stringify({
      ref: booking.booking_ref,
      pnr: flightBooking.pnr ?? order.bookingReference ?? null,
      id: booking.id,
    }),

    pdfDownloadPath: `/api/v1/flights/bookings/${bookingId}/eticket`,
    emailResendPath: `/api/v1/flights/bookings/${bookingId}/eticket/email`,
  };

  return sendSuccess(res, HTTP.OK, "E-ticket data retrieved", eticket);
});

module.exports = { getETicketData };
