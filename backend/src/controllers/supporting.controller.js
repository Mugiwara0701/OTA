"use strict";

const rateLimit = require("express-rate-limit");
const supportingService = require("../services/supporting.services");
const { asyncHandler } = require("../utils/AppError");
const { sendSuccess } = require("../helpers/helper.response");
const { HTTP } = require("../constants/index");

// ──── TIGHT RATE LIMIT FOR AUTOCOMPLETE TO AVOID DUFFEL API ABUSE ──────────────────────────────────────────────────────────────
const autoCompleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "To many auto complete requests. Slow down",
  },
});

// GET /api/v1/meta/places/search?q=LON
const searchPlaces = [
  autoCompleteLimiter,
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      throw new AppError(
        "Query params 'q' must be at least 2 characters",
        HTTP.BAD_REQUEST,
      );
    }
    const places = await supportingService.searchPlaces(q.trim());
    return sendSuccess(res, HTTP.OK, "Places retrieved", places, {
      query: q,
      total: places.length,
    });
  }),
];

// GET /api/v1/meta/airports?country=GB&iata=LHR
const listAirports = asyncHandler(async (req, res) => {
  const { country, iata } = req.query;
  const airports = await supportingService.listAirports({
    iataCode: iata?.toUpperCase(),
    iataCountryCode: country?.toUpperCase(),
  });
  return sendSuccess(res, HTTP.OK, "Airport retrieved", airports, {
    total: airports.length,
  });
});

// GET /api/v1/meta/airports/:id
const getAirport = asyncHandler(async (req, res) => {
  const airport = await supportingService.getAirport(req.params.id);
  return sendSuccess(res, HTTP.OK, "Airport retrieved", airport);
});

// GET /api/v1/meta/airlines?iata=BA
const listAirlines = asyncHandler(async (req, res) => {
  const { iata } = req.query;
  const airlines = await supportingService.listAirlines({
    iataCode: iata?.toUpperCase(),
  });
  return sendSuccess(res, HTTP.OK, "Airlines retrieved", airline, {
    total: airline.length,
  });
});

// GET /api/v1/meta/airlines/:id
const getAirline = asyncHandler(async (req, res) => {
  const airline = await supportingService.getAirlines(req.params.id);
  return sendSuccess(res, HTTP.OK, "Airline retrieved", airline);
});

// GET /api/v1/meta/aircraft
const listAircraft = asyncHandler(async (req, res) => {
  const aircraft = await supportingService.listAircraft();
  return sendSuccess(res, HTTP.OK, "Aircraft retrieved", aircraft, {
    total: aircraft.length,
  });
});

// GET /api/v1/meta/cities?country=GB
const listCities = asyncHandler(async (req, res) => {
  const { country } = req.query;
  const cities = await supportingService.listCities({
    iataCountryCode: country?.toUpperCase(),
  });
  return sendSuccess(res, HTTP.OK, "Cities retrieved", cities, {
    total: cities.length,
  });
});

// GET /api/v1/meta/loyalty-programmes
const listLoyaltyProgrammes = asyncHandler(async (req, res) => {
  const programmes = await supportingService.listLoyaltyProgrammes();
  return sendSuccess(res, HTTP.OK, "Loyalty programmes retrieved", programmes);
});

module.exports = {
  searchPlaces,
  listAirports,
  getAirport,
  listAirlines,
  getAirline,
  listAircraft,
  listCities,
  listLoyaltyProgrammes,
};
