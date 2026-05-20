"use strict";

const duffel = require("../../config/duffel");
const { normalizeDuffelError } = require("../../helpers/helper.helper");

// ── SEARCH ─────────────────────────────────────────────────────────────
async function createSearch({
  pickupLocationIata,
  dropoffLocationIata,
  pickupDateTime,
  dropoffDateTime,
  driverAge,
}) {
  try {
    const response = await duffel.carRentals.searchResults.create({
      pick_up_location: { type: "airport", iata_code: pickupLocationIata },
      drop_off_location: { type: "airport", iata_code: dropoffLocationIata },
      pick_up_date_time: pickupDateTime,
      drop_off_date_time: dropoffDateTime,
      driver: { age: driverAge || 30 },
    });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getSearchResult(searchId) {
  try {
    const response = await duffel.carRentals.searchResults.get(searchId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── QUOTES ─────────────────────────────────────────────────────────────
async function createQuote(rateId) {
  try {
    const response = await duffel.carRentals.quotes.create({
      rating_id: rateId,
    });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getQuote(quoteId) {
  try {
    const response = await duffel.carRentals.quotes.get(quoteId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── BOOKINGS ─────────────────────────────────────────────────────────────
async function createBooking({ quoteId, driver, paymentType = "balance" }) {
  try {
    const response = await duffel.carRentals.bookings.create({
      quote_id: quoteId,
      driver,
      payment: { type: paymentType },
    });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getBooking(bookingId) {
  try {
    const response = await duffel.carRentals.bookings.get(bookingId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function cancelBooking(bookingId) {
  try {
    const response = await duffel.carRentals.bookings.cancel(bookingId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

module.exports = {
  createSearch,
  getSearchResult,
  createQuote,
  getQuote,
  createBooking,
  getBooking,
  cancelBooking,
};
