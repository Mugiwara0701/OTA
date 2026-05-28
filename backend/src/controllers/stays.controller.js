"use strict";

const staysService = require("../services/stays.services");
const { asyncHandler } = require("../utils/AppError");
const { sendSuccess, paginationMeta } = require("../helpers/helper.response");
const { HTTP, PAGINATION } = require("../constants/index");

// POST /api/v1/stays/search
const searchHotels = asyncHandler(async (req, res) => {
  const {
    latitude,
    longitude,
    checkInDate,
    checkOutDate,
    rooms = 1,
    guests = 1,
    radius = 10,
  } = req.body;

  const result = await staysService.searchHotels({
    latitude,
    longitude,
    checkInDate,
    checkOutDate,
    rooms,
    guests,
    radius,
  });
  return sendSuccess(res, HTTP.OK, "Hotels retrieved successfully", result, {
    total: result.totalResults,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/v1/stays/accommodations/:accommodationId
const getAccommodation = asyncHandler(async (req, res) => {
  const { accommodationId } = req.params;
  const result = await staysService.getHotelDetails(accommodationId);
  return sendSuccess(res, HTTP.OK, "Accommodation details retrieved", result);
});

// POST /api/v1/stays/quotes
const createQuote = asyncHandler(async (req, res) => {
  const { rateId } = req.body;
  const result = await staysService.createQuote(rateId);
  return sendSuccess(res, HTTP.CREATED, "Quote created", result);
});

// GET /api/v1/stays/results/:resultId/rates
const getHotelRates = asyncHandler(async (req, res) => {
  const { resultId } = req.params;
  const result = await staysService.getHotelRates(resultId);
  return sendSuccess(
    res,
    HTTP.OK,
    "Hotel rates retrieved successfully",
    result,
  );
});

// POST /api/v1/stays/book
const initBooking = asyncHandler(async (req, res) => {
  const {
    rateId,
    hotelId,
    hotelName,
    checkInDate,
    checkOutDate,
    rooms,
    guests,
  } = req.body;
  const userId = req.user.id;
  const result = await staysService.initHotelBooking({
    userId,
    rateId,
    hotelId,
    hotelName,
    checkInDate,
    checkOutDate,
    rooms,
    guests,
  });

  return sendSuccess(
    res,
    HTTP.CREATED,
    "Hotel booking initiated. Proceed to payment.",
    result,
  );
});

// POST /api/v1/stays/bookings/:bookingId/confirm
const confirmBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const { guests, paymentProvider } = req.body;
  const userId = req.user.id;

  const result = await staysService.confirmHotelBooking({
    bookingId,
    userId,
    guests,
    paymentProvider,
  });
  return sendSuccess(res, HTTP.OK, "Hotel booking confirmed", result);
});

// GET /api/v1/stays/bookings
const listBookings = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE;
  const limit = Math.min(
    parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT,
    PAGINATION.MAX_LIMIT,
  );
  const { bookings, total } = await staysService.listUserBookings(userId, {
    page,
    limit,
    status: req.query.status,
  });
  return sendSuccess(
    res,
    HTTP.OK,
    "Booking details retrieved",
    bookings,
    paginationMeta(page, limit, total),
  );
});

// GET /api/v1/stays/bookings/:bookingId
const getBooking = asyncHandler(async (req, res) => {
  const result = await staysService.getBooking(
    req.params.bookingId,
    req.user.id,
  );
  return sendSuccess(res, HTTP.OK, "Booking details retrieved", result);
});

// POST /api/v1/stays/bookings/:bookingId/cancel
const cancelBooking = asyncHandler(async (req, res) => {
  const result = await staysService.cancelHotelBooking(
    req.params.bookingId,
    req.user.id,
    req.body.reason || null, // ← add this
  );
  return sendSuccess(res, HTTP.OK, "Hotel booking cancelled", result);
});

module.exports = {
  searchHotels,
  getHotelRates,
  getAccommodation,
  createQuote,
  initBooking,
  confirmBooking,
  listBookings,
  getBooking,
  cancelBooking,
};
