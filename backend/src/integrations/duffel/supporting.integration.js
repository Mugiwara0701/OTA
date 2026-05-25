"use strict";

const NodeCache = require("node-cache");
const duffel = require("../../config/duffel");
const {
  normalization,
  normalizeDuffelError,
} = require("../../helpers/booking.helper");
const logger = require("../../config/logger");

// 24-hour TTL for static reference data
const cache = new NodeCache({
  stdTTL: 86400,
  checkperiod: 3600,
});

async function withCache(key, fn) {
  const hit = cache.get(key);

  if (hit !== undefined) {
    logger.debug(`[SupportingCache] HIT → ${key}`);
    return hit;
  }

  const result = await fn();
  cache.set(key, result);

  logger.debug(`[SupportingCache] SET → ${key}`);

  return result;
}

// Collect all pages from a Duffel pagination list iterator
async function collectAll(iterator) {
  const items = [];

  for await (const item of iterator) {
    items.push(item);
  }

  return items;
}

// Place real-time autocomplete — no cache
async function searchPlaces(query) {
  try {
    const response = await duffel.suggestions.list({ query });
    return response;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// Airports
async function listAirports({ iataCode, iataCountryCode } = {}) {
  const key = `airport:${iataCountryCode || "all"}:${iataCode || "all"}`;

  return withCache(key, async () => {
    try {
      const params = {};

      if (iataCode) {
        params.iata_code = iataCode;
      }

      if (iataCountryCode) {
        params.iata_country_code = iataCountryCode;
      }

      return collectAll(await duffel.airports.list(params));
    } catch (err) {
      throw normalizeDuffelError(err);
    }
  });
}

async function getAirport(id) {
  return withCache(`airport:${id}`, async () => {
    try {
      const response = await duffel.airports.get(id);
      return response.data;
    } catch (err) {
      throw normalizeDuffelError(err);
    }
  });
}

// ── Airlines
async function listAirlines({ iataCode } = {}) {
  const key = `airlines:${iataCode || "all"}`;
  return withCache(key, async () => {
    try {
      const params = {};
      if (iataCode) params.iata_code = iataCode;
      return collectAll(await duffel.airlines.list(params));
    } catch (err) {
      throw normalizeDuffelError(err);
    }
  });
}
async function getAirline(id) {
  return withCache(`airline:${id}`, async () => {
    try {
      const response = await duffel.airlines.get(id);
      return response.data;
    } catch (err) {
      throw normalizeDuffelError(err);
    }
  });
}

// ── Aircraft
async function listAircraft() {
  return withCache("aircraft:all", async () => {
    try {
      return collectAll(await duffel.aircraft.list());
    } catch (err) {
      throw normalizeDuffelError(err);
    }
  });
}

// ── Cities
async function listCities({ iataCountryCode } = {}) {
  const key = `cities:${iataCountryCode || "all"}`;
  return withCache(key, async () => {
    try {
      const params = {};
      if (iataCountryCode) params.iata_country_code = iataCountryCode;
      return collectAll(await duffel.cities.list(params));
    } catch (err) {
      throw normalizeDuffelError(err);
    }
  });
}

// ── Loyalty Programmes
async function listLoyaltyProgrammes() {
  return withCache("loyalty:all", async () => {
    try {
      return collectAll(await duffel.loyaltyProgrammes.list());
    } catch (err) {
      throw normalizeDuffelError(err);
    }
  });
}

// ── Cache Management
function clearCache(prefix) {
  const keys = cache.keys().filter((k) => k.startsWith(prefix));
  cache.del(keys);
  return keys.length;
}

function getCacheStats() {
  return cache.getStats();
}
module.exports = {
  searchPlaces,
  listAirports,
  getAirport,
  listAirlines,
  getAirline,
  listAircraft,
  listCities,
  listLoyaltyPrograms,
  clearCache,
  getCacheStats,
};
