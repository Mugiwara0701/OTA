"use strict";
const duffel = require("../../config/duffel");
const { normalizeDuffelError } = require("../../helpers/booking.helper");

// ── SEARCH ─────────────────────────────────────────────────────────────
// ── SEARCH ─────────────────────────────────────────────────────────────
async function createSearch({
  latitude,
  longitude,
  checkInDate,
  checkOutDate,
  rooms = 1,
  guests = 1,
  radius = 10,
}) {
  try {
    const guestArray = [];
    for (let i = 0; i < guests; i++) {
      guestArray.push({ type: "adult" });
    }

    const searchResponse = await duffel.stays.search({
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      rooms,
      guests: guestArray,
      location: {
        geographic_coordinates: { latitude, longitude },
        radius,
      },
    });

    // Returns { results: [...], created_at: "..." }
    return searchResponse.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// fetchAllRates takes a single result's ID, returns full rates for that hotel
async function getSearchResult(searchResultId) {
  try {
    const response =
      await duffel.stays.searchResults.fetchAllRates(searchResultId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── QUOTES ─────────────────────────────────────────────────────────────
async function createQuote(rateId) {
  try {
    const response = await duffel.stays.quotes.create(rateId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getQuote(quoteId) {
  try {
    const response = await duffel.stays.quotes.get(quoteId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── BOOKINGS ─────────────────────────────────────────────────────────────
async function createBooking({ quoteId, guests, paymentType = "balance" }) {
  try {
    // email and phone_number are top-level, taken from the lead guest
    const leadGuest = guests[0];
    const response = await duffel.stays.bookings.create({
      quote_id: quoteId,
      email: leadGuest.email,
      phone_number: leadGuest.phone_number,
      guests: guests.map(({ given_name, family_name, user_id }) => ({
        given_name,
        family_name,
        ...(user_id && { user_id }),
      })),
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
    const response = await duffel.stays.bookingPaymentInstructions(bookingId);
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
