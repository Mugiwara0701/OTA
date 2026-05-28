"use strict";

const supporting = require("../integrations/duffel/supporting.integration");
const { AppError } = require("../utils/AppError");
const { HTTP } = require("../constants/index");

// ──── PLACES AUTOCOMPLETE ──────────────────────────────────────────────────────────────
async function searchPlaces(query) {
  if (!query || query.trim().length < 2) {
    throw new AppError(
      "Search query must be at least 2 characters",
      HTTP.BAD_REQUEST,
    );
  }
  const raw = await supporting.searchPlaces(query.trim());
  return (raw || []).map((p) => ({
    id: p.id,
    type: p.type,
    iataCode: p.iata_code,
    name: p.name,
    city: p.city_name || p.name,
    country: p.country_name,
    countryCode: p.iata_country_code,
    latitude: p.latitude,
    longitude: p.longitude,
    timeZone: p.time_zone,
  }));
}

// ──── AIRPORTS ──────────────────────────────────────────────────────────────
async function listAirports({ iataCode, iataCountryCode } = {}) {
  const raw = await supporting.listAirports({ iataCode, iataCountryCode });
  return raw.map(mapAirport);
}

async function getAirport(id) {
  const raw = await supporting.getAirport(id);
  return mapAirport(raw);
}

function mapAirport(a) {
  return {
    id: a.id,
    iataCode: a.iata_code,
    name: a.name,
    city: a.city_name,
    country: a.iata_country_code,
    latitude: a.latitude,
    longitude: a.longitude,
    timeZone: a.time_zone,
  };
}

// ──── AIRLINES ──────────────────────────────────────────────────────────────
async function listAirlines({ iataCode } = {}) {
  const raw = await supporting.listAirlines({ iataCode });
  return raw.map(mapAirline);
}

async function getAirlines(id) {
  const raw = await supporting.getAirline(id);
  return mapAirline(raw);
}

function mapAirline(a) {
  return {
    id: a.id,
    iataCode: a.iata_code,
    name: a.name,
    logoUrl: a.logo_symbol_url,
    logoLockupUrl: a.logo_lockup_url,
    conditions: a.conditions_of_carriage_url,
  };
}

// ──── AIRCRAFT ──────────────────────────────────────────────────────────────
async function listAircraft() {
  const raw = await supporting.listAircraft();
  return raw.map((a) => ({ id: a.id, iataCode: a.iata_code, name: a.name }));
}

// ──── CITIES ──────────────────────────────────────────────────────────────
async function listCities({ iataCountryCode } = {}) {
  const raw = await supporting.listCities(); // always fetch all, cache handles it
  const mapped = raw.map((c) => ({
    id: c.id,
    iataCode: c.iata_code,
    name: c.name,
    countryCode: c.iata_country_code,
    airports: (c.airports || []).map(mapAirport),
  }));

  // filter after mapping if country was requested
  if (iataCountryCode) {
    return mapped.filter(
      (c) => c.countryCode === iataCountryCode.toUpperCase(),
    );
  }

  return mapped;
}

// ──── LOYALTY PROGRAMMES ──────────────────────────────────────────────────────────────
async function listLoyaltyProgrammes() {
  const raw = await supporting.listLoyaltyProgrammes();
  return raw.map((lp) => ({
    id: lp.id,
    name: lp.name,
    url: lp.url,
    airlineIataCode: lp.owner?.iata_code,
    airlineName: lp.owner?.name,
  }));
}

// ──── CACHE STATS (ADMIN USE) ──────────────────────────────────────────────────────────────
function getCacheStats() {
  return supporting.getCacheStats();
}

function clearCache(prefix = "") {
  return supporting.clearCache(prefix);
}

module.exports = {
  searchPlaces,
  listAirports,
  getAirport,
  listAirlines,
  getAirlines,
  listAircraft,
  listCities,
  listLoyaltyProgrammes,
  getCacheStats,
  clearCache,
};
