"use strict";
const duffel = require("../../config/duffel");
const { normalizeDuffelError } = require("../../helpers/booking.helper");

// ── SEARCH ─────────────────────────────────────────────────────────────
async function createSearch({
  latitude,
  longitude,
  checkInDate,
  checkOutDate,
  rooms = 1,
  guest = 1,
  radius = 10,
}) {
  try {
    const guestArray = [];
    for (let i = 0; i < guest; i++) {
      guestArray.push({ type: "adult" });
    }
    const response = await duffel.stays.searchResults.create({
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      rooms,
      guests: guestArray,
      locations: {
        geographic_coordinates: { latitude, longitude },
        radius,
        radius_unit: "km",
      },
    });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getSearchResult(searchId) {
  try {
    const response = await duffel.stays.searchResults.get(searchId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── QUOTES ─────────────────────────────────────────────────────────────
async function createQuote(rateId) {
  try {
    const response = await duffel.stays.quotes.create({ rate_id: rateId });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getQuote(quoteId) {
  try {
    const response = await duffel.stay.quotes.get(quoteId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── BOOKINGS ─────────────────────────────────────────────────────────────
async function createBooking({ quoteId, guests, paymentType = "balance" }) {
  try {
    const response = await duffel.stays.bookings.create({
      quote_id: quoteId,
      guests,
      payments: { type: paymentType },
    });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getBooking(bookingId) {
  try {
    const response = await duffel.stays.bookings.get(bookingId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function cancelBooking(bookingId) {
  try {
    const response = await duffel.stays.bookings.cancel(bookingId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── ACCOMMODATION DETAILS ─────────────────────────────────────────────────────────────
async function getAccommodation(accommodationId) {
  try {
    const response = await duffel.stays.accommodation.get(accommodationId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── BOOKING PAYMENT INSTRUCTIONS ─────────────────────────────────────────────────────────────
async function getPaymentInstructions(bookingId) {
  try {
    const response = await duffel.stay.bookingPaymentInstructions(bookingId);
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
  getAccommodation,
  getPaymentInstructions,
};
