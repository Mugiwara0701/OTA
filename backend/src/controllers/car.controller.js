"use strict";

const carServices = require("../services/car.services");
const { asyncHandler } = require("../utils/AppError");
const { sendSuccess, paginationMeta } = require("../helpers/helper.response");
const { HTTP, PAGINATION } = require("../constants/index");
const { createQuote } = require("../integrations/duffel/car.integration");

// POST /api/v1/cars/search
const searchCars = asyncHandler(async (req, res) => {
  const {
    pickupLocationIata,
    dropoffLocationIata,
    pickupDateTime,
    dropoffDateTime,
    driverAge,
  } = req.body;

  const result = await carServices.searchCars({
    pickupLocationIata: pickupLocationIata.toUpperCase(),
    dropOffLocationIata: dropoffLocationIata.toUpperCase(),
    pickupDateTime,
    dropoffDateTime,
    driverAge,
  });

  return sendSuccess(
    res,
    HTTP.OK,
    "Car rentals retrieved successfully",
    result,
    {
      total: result.totalResults,
      timestamp: new Date().toISOString(),
    },
  );
});

// POST /api/v1/cars/quotes
const createQuoteHandler = asyncHandler(async (req, res) => {
  const { rateId } = req.body;

  const result = await carServices.getQuoteDetail(rateId);

  return sendSuccess(res, HTTP.CREATED, "Car quote retrieved", result);
});

// GET /api/v1/cars/quotes/:quoteId
const getQuote = asyncHandler(async (req, res) => {
  const result = await carServices.getQuoteDetail(req.params.quoteId);
  return sendSuccess(res, HTTP.OK, "Quote details retrieved", result);
});

// POST /api/v1/cars/book
const initBooking = asyncHandler(async (req, res) => {
  const {
    rateId,
    pickupLocation,
    droppffLocation,
    pickupDate,
    droppffDate,
    carType,
  } = req.body;
  const userId = req.user.id;
  const result = await carServices.initCarBooking({
    userId,
    rateId,
    pickupLocation,
    dropoffLoaction,
    pickupDate,
    dropoffDate,
    carType,
  });
  return sendSuccess(
    res,
    HTTP.CREATED,
    "Car booking initiated. Proceed to payment.",
    result,
  );
});

// POST /api/v1/cars/bookings/:bookingId/confirm
const confirmBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const { driver, paymentProvider } = req.body;
  const userId = req.user.id;

  const result = await carServices.confirmCarBooking({
    bookingId,
    userId,
    driver,
    paymentProvide,
  });
  return sendSuccess(res, HTTP.OK, "Car booking confirmed", result);
});

// GET /api/v1/cars/bookings
const listBookings = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE;
  const limit = Math.min(
    parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT,
    PAGINATION.MAX_LIMIT,
  );

  const { bookings, total } = await carServices.listUserBookings(userId, {
    page,
    limit,
    status: req.params.status,
  });

  return sendSuccess(
    res,
    HTTP.OK,
    "Car bookings retrieved",
    bookings,
    paginationMeta(page, limit, total),
  );
});

// GET /api/v1/cars/bookings/:bookingId
const getBooking = asyncHandler(async (req, res) => {
  const result = await carServices.getBooking(
    req.params.bookingId,
    req.user.id,
  );
  return sendSuccess(res, HTTP.OK, "Car booking details retrieved", result);
});

// POST /api/v1/cars/bookings/:bookingId/cancel
const cancelBooking = asyncHandler(async (req, res) => {
  const result = await carServices.cancelCarBooking(
    req.params.bookingId,
    req.user.id,
  );
  return sendSuccess(res, HTTP.OK, "Car booking cancelled", result);
});

module.exports = {
  searchCars,
  createQuote,
  getQuote,
  initBooking,
  confirmBooking,
  listBookings,
  getBooking,
  cancelBooking,
};
