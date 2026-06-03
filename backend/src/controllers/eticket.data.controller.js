"use strict";

/**
 * getETicketData
 *
 * GET /api/v1/flights/bookings/:bookingId/eticket/data
 *
 * Returns a single, flat JSON object shaped for the mobile/web app
 * to render the e-ticket natively — no PDF processing required on the client.
 *
 * Add this to eticket.controller.js alongside downloadETicket & emailETicket.
 */

const { asyncHandler } = require("../utils/AppError");
const AppError = require("../utils/AppError");
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
  // Duffel passengers come back in the same order they were submitted
  return orderPassengers.reduce((map, p, idx) => {
    map[p.id] = {
      ...p,
      passportNumber: decrypt(travelers[idx]?.passport_number) ?? null,
      nationality: travelers[idx]?.nationality ?? null,
    };
    return map;
  }, {});
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
  if (!flightBooking?.duffel_order_id) {
    throw new AppError(
      "Flight order not found for this booking",
      HTTP.NOT_FOUND,
    );
  }

  // ── 2. Fetch live Duffel order ────────────────────────────────────────────
  const rawOrder = await flightIntegration.getOrder(
    flightBooking.duffel_order_id,
  );
  const order = mapDuffelOrder(rawOrder);

  // ── 3. Load user profile ──────────────────────────────────────────────────
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("first_name, last_name, email, phone")
    .eq("id", booking.user_id)
    .single();

  // ── 4. Build passenger lookup ─────────────────────────────────────────────
  const passengerLookup = buildPassengerLookup(
    order.passengers || [],
    booking.travelers || [],
  );

  // ── 5. Build per-segment ticket sections ─────────────────────────────────
  // Each slice = one directional journey (outbound / return / leg N)
  // Each segment = one actual flight within that journey
  const journeys = (order.slices || []).map((slice, sliceIdx) => {
    const segments = (slice.segments || []).map((seg) => {
      // Seat assignments per passenger for this segment
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
        // Flight identification
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
        // Origin
        origin: {
          iataCode: seg.origin?.iataCode ?? null,
          cityName: seg.origin?.cityName ?? null,
          airportName: seg.origin?.name ?? null,
          terminal: seg.originTerminal ?? null,
          countryCode: seg.origin?.countryCode ?? null,
          timeZone: seg.origin?.timeZone ?? null,
        },
        // Destination
        destination: {
          iataCode: seg.destination?.iataCode ?? null,
          cityName: seg.destination?.cityName ?? null,
          airportName: seg.destination?.name ?? null,
          terminal: seg.destinationTerminal ?? null,
          countryCode: seg.destination?.countryCode ?? null,
          timeZone: seg.destination?.timeZone ?? null,
        },
        // Times — raw ISO for the app to localize, plus pre-formatted strings
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
        // Intermediate stops (technical stops within one segment)
        stops: (seg.stops || []).map((st) => ({
          airport: { iataCode: st.airport?.iataCode, name: st.airport?.name },
          arrivingAt: fmt(st.arrivingAt),
          departingAt: fmt(st.departingAt),
          duration: fmtDuration(st.duration),
        })),
        // Passenger seat data
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

  // ── 6. Passenger list ─────────────────────────────────────────────────────
  const passengers = (order.passengers || []).map((p, idx) => {
    const traveler = booking.travelers?.[idx] ?? {};
    return {
      passengerId: p.id,
      type: p.type, // "adult" | "child" | "infant_without_seat"
      title: p.title ?? null,
      firstName: p.givenName,
      lastName: p.familyName,
      dateOfBirth: p.bornOn ?? traveler.date_of_birth ?? null,
      gender: p.gender ?? traveler.gender ?? null,
      passportNumber: decrypt(traveler.passport_number) ?? null,
      nationality: traveler.nationality ?? null,
      email: p.email ?? traveler.email ?? null,
      // e-ticket number(s) for this passenger
      ticketNumbers: (order.documents || [])
        .filter(
          (d) =>
            d.type === "electronic_ticket" && d.passengerIds.includes(p.id),
        )
        .map((d) => d.uniqueIdentifier),
    };
  });

  // ── 7. Payment info ───────────────────────────────────────────────────────
  const payment = booking.payments?.[0] ?? null;

  // ── 8. Compose final response ─────────────────────────────────────────────
  const eticket = {
    // ── Ticket meta ─────────────────────────────────────────────────────────
    bookingId: booking.id,
    bookingRef: booking.booking_ref,
    status: booking.status,
    issuedAt: fmt(booking.created_at),

    // ── Airline PNR ──────────────────────────────────────────────────────────
    pnr: flightBooking.pnr ?? order.bookingReference ?? null,
    // Some itineraries have per-carrier PNRs
    allReferences: (order.bookingReferences || []).map((br) => ({
      reference: br.reference,
      airlineName: br.carrier?.name ?? null,
      airlineCode: br.carrier?.iataCode ?? null,
    })),

    // ── Booker info ──────────────────────────────────────────────────────────
    booker: {
      firstName: user?.first_name ?? null,
      lastName: user?.last_name ?? null,
      email: user?.email ?? null,
      phone: user?.phone ?? null,
    },

    // ── Journey segments ─────────────────────────────────────────────────────
    journeys,

    // ── Passenger details ─────────────────────────────────────────────────────
    passengers,

    // ── Pricing ───────────────────────────────────────────────────────────────
    payment: {
      totalAmount: parseFloat(booking.total_amount).toFixed(2),
      currency: booking.currency,
      status: payment?.status ?? "COMPLETED",
      paidAt:
        payment?.paid_at ?? payment?.created_at ?? fmt(booking.created_at),
      provider: payment?.payment_provider ?? null,
    },

    // ── Policies ─────────────────────────────────────────────────────────────
    conditions: order.conditions ?? null,

    // ── QR payload (app can generate/display its own QR from this) ───────────
    qrPayload: JSON.stringify({
      ref: booking.booking_ref,
      pnr: flightBooking.pnr ?? order.bookingReference ?? null,
      id: booking.id,
    }),

    // ── Download link (for "Save PDF" button) ────────────────────────────────
    // The app constructs this URL from bookingId — included here for convenience
    pdfDownloadPath: `/api/v1/flights/bookings/${bookingId}/eticket`,
    emailResendPath: `/api/v1/flights/bookings/${bookingId}/eticket/email`,
  };

  return sendSuccess(res, HTTP.OK, "E-ticket data retrieved", eticket);
});

module.exports = { getETicketData };
