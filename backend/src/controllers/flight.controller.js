"use strict";

const flightService = require("../services/flight.services");
const flightIntegration = require("../integrations/duffel/flight.integration");
const { asyncHandler } = require("../utils/AppError");
const { sendSuccess, paginationMeta } = require("../helpers/helper.response");
const { HTTP, PAGINATION } = require("../constants/index");

// POST /api/v1/flights/search
const searchFlights = asyncHandler(async (req, res) => {
  const {
    origin,
    destination,
    departureDate,
    returnDate,
    adults = 1,
    children = 0,
    infants = 0,
    cabinClass = "economy",
    maxConnections,
  } = req.body;

  const result = await flightService.searchFlights({
    origin: origin.toUpperCase(),
    destination: destination.toUpperCase(),
    departureDate,
    returnDate,
    adults,
    children,
    infants,
    cabinClass,
    maxConnections,
  });

  return sendSuccess(res, HTTP.OK, "Flight retrieved successfully", result, {
    total: result.totalOffers,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/v1/flights/offers/:offerId
const getOffer = asyncHandler(async (req, res) => {
  const { offerId } = req.params;
  const result = await flightService.getOfferDetails(offerId);
  return sendSuccess(res, HTTP.OK, "offer details retrieved", result);
});

// GET /api/v1/flights/offers/:offerId/seat-map
const getSeatMap = asyncHandler(async (req, res) => {
  const { offerId } = req.params;
  let seatMaps = [];
  let available = false;
  let reason = null;

  try {
    seatMaps = await flightIntegration.getSeatMap(offerId);
    available = seatMaps.length > 0;
    if (!available) {
      reason =
        "This airline or flight does not provide seat map data via Duffel. " +
        "In test mode, only specific Duffel test carriers (e.g. ZZ airlines) support seat maps.";
    }
  } catch (err) {
    // Duffel 422 seat_map_not_available — degrade gracefully
    reason = err.message || "Seat map not available for this offer.";
  }

  // Shape each seat map so the frontend gets everything it needs to render
  // the cabin layout and know which seats are available vs taken.
  const shaped = seatMaps.map((sm) => ({
    id: sm.id,
    segment_id: sm.segment_id,
    slice_id: sm.slice_id,
    cabins: (sm.cabins || []).map((cabin) => ({
      id: cabin.id,
      deck: cabin.deck,
      aisles: cabin.aisles,
      wings: cabin.wings || null,
      rows: (cabin.rows || []).map((row, rowIndex) => ({
        row_index: rowIndex,
        sections: (row.sections || []).map((section) => ({
          elements: (section.elements || []).map((el) => {
            if (el.type !== "seat") {
              // Non-seat elements: exit_row, lavatory, galley, bassinet, empty
              return { type: el.type };
            }
            const hasServices =
              Array.isArray(el.available_services) &&
              el.available_services.length > 0;
            return {
              type: "seat",
              designator: el.designator,
              name: el.name || null,
              disclosures: el.disclosures || [],
              // available = true means the passenger CAN select this seat
              available: hasServices,
              // services contains the id the frontend must send back at booking time
              services: hasServices
                ? el.available_services.map((s) => ({
                    id: s.id,
                    passenger_id: s.passenger_id,
                    total_amount: s.total_amount,
                    total_currency: s.total_currency,
                  }))
                : [],
            };
          }),
        })),
      })),
    })),
  }));

  return sendSuccess(res, HTTP.OK, "Seat map retrieved", {
    available,
    seatMaps: shaped,
    ...(reason && { reason }),
  });
});

// POST /api/v1/flights/book
const initBooking = asyncHandler(async (req, res) => {
  const { offerId, passengers, tripType } = req.body;
  const userId = req.user.id;

  const result = await flightService.initFlightBooking({
    userId,
    offerId,
    passengers,
    tripType,
  });
  return sendSuccess(
    res,
    HTTP.CREATED,
    "Booking initiated. Proceed to payment.",
    result,
  );
});

// POST /api/v1/flights/bookings/:bookingId/confirm
// POST /api/v1/flights/bookings/:bookingId/confirm
const confirmBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;
  const { paymentProvider, selectedServices } = req.body;
  // selectedServices shape (optional): [{ id: "ase_xxx", passenger_id: "pas_xxx" }]

  const result = await flightService.confirmFlightBooking({
    bookingId,
    userId,
    paymentProvider,
    selectedServices: selectedServices || [],
  });

  return sendSuccess(res, HTTP.OK, "Flight booking confirmed", result);
});

// GET /api/v1/flights/bookings
const listBookings = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE;
  const limit = Math.min(
    parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT,
    PAGINATION.MAX_LIMIT,
  );
  const { status } = req.query;
  const { bookings, total } = await flightService.listUserBookings(userId, {
    page,
    limit,
    status,
  });
  return sendSuccess(
    res,
    HTTP.OK,
    "Bookings retrieved",
    bookings,
    paginationMeta(page, limit, total),
  );
});

// GET /api/v1/flights/bookings/:bookingId
const getBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;
  const result = await flightService.getBooking(bookingId, userId);
  return sendSuccess(res, HTTP.OK, "Booking details retrieved", result);
});

// POST /api/v1/flights/bookings/:bookingId/cancel
const cancelBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;
  const result = await flightService.cancelFlightBooking(bookingId, userId);
  return sendSuccess(res, HTTP.OK, "Booking cancelled successfully", result);
});

// POST /api/v1/flights/bookings/:bookingId/change-request
const createChangeRequest = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;
  const { slices } = req.body;
  const result = await flightService.createChangeRequest({
    bookingId,
    userId,
    slices,
  });
  return sendSuccess(res, HTTP.CREATED, "Change request created", result);
});

// GET /api/v1/flights/offers
const listOffers = asyncHandler(async (req, res) => {
  const { offerRequestId, sortBy, maxPrice, maxStops, airlines } = req.query;

  const result = await flightService.listOffers({
    offerRequestId,
    sortBy,
    maxPrice,
    maxStops,
    airlines,
  });

  return sendSuccess(res, HTTP.OK, "Offers retrieved successfully", result);
});

// GET /api/v1/flights/bookings/:bookingId/change-offers
const listChangeOffers = asyncHandler(async (req, res) => {
  const { orderChangeRequestId } = req.query;
  const offers =
    await flightIntegration.listOrderChangeOffers(orderChangeRequestId);
  return sendSuccess(res, HTTP.OK, "Change offers retrieved", offers);
});

// POST /api/v1/flights/bookings/:bookingId/change/confirm
const confirmChange = asyncHandler(async (req, res) => {
  const { orderChangeOfferId } = req.body;
  const orderChange =
    await flightIntegration.createOrderChange(orderChangeOfferId);
  const confirmed = await flightIntegration.confirmOrderChange(orderChange.id);
  return sendSuccess(res, HTTP.OK, "Flight change confirmed", confirmed);
});

module.exports = {
  searchFlights,
  listOffers,
  getOffer,
  getSeatMap,
  initBooking,
  confirmBooking,
  listBookings,
  getBooking,
  cancelBooking,
  createChangeRequest,
  listChangeOffers,
  confirmChange,
};
