"use strict";

const duffel = require("../../config/duffel");
const { normalizeDuffelError } = require("../../helpers/booking.helper");

// ── OFFER REQUEST ─────────────────────────────────────────────────────────────
async function createOfferRequest({
  slices,
  passengers,
  cabinClass,
  maxConnections,
}) {
  try {
    const payload = {
      slices: slices.map((s) => ({
        origin: s.origin,
        destination: s.destination,
        departure_date: s.departureDate,
      })),
      passengers: passengers.map((p) => {
        const base = { type: p.type };
        if (p.age !== undefined) base.age = p.age;
        return base;
      }),
      cabin_class: cabinClass || "economy",
      return_offers: true,
    };
    if (maxConnections !== undefined) {
      payload.max_connections = maxConnections;
    }
    const response = await duffel.offerRequests.create(payload);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getOfferRequest(offerRequestId) {
  try {
    const response = await duffel.offerRequests.get(offerRequestId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── OFFERS ─────────────────────────────────────────────────────────────
async function listOffers({
  offerRequestId,
  sort = "total_amount",
  maxConnections,
}) {
  try {
    const params = {
      offer_request_id: offerRequestId,
      sort,
    };
    if (maxConnections !== undefined) params.max_connections = maxConnections;

    // ✅ listWithGenerator() returns the async iterable
    const offers = [];
    for await (const offer of duffel.offers.listWithGenerator(params)) {
      offers.push(offer.data); // each yielded value has a .data property
    }
    return offers;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getOffer(offerId) {
  try {
    const response = await duffel.offers.get(offerId, {
      return_available_services: true,
    });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── ORDERS ─────────────────────────────────────────────────────────────
async function createOrder({
  selectedOfferId,
  passengers,
  payments = [],
  metadata = {},
  services = [],
}) {
  try {
    const payload = {
      selected_offers: [selectedOfferId],
      passengers,
      payments,
      metadata,
    };
    // Only include services if seats were selected — Duffel rejects an empty array
    if (services.length > 0) {
      payload.services = services.map((s) => ({ id: s.id, quantity: 1 }));
    }
    const response = await duffel.orders.create(payload);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getOrder(orderId) {
  try {
    const response = await duffel.orders.get(orderId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function updateOrder(orderId, { metadata }) {
  try {
    const response = await duffel.orders.update(orderId, { metadata });
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── SEAT MAP ─────────────────────────────────────────────────────────────
async function getSeatMap(offerId) {
  try {
    const response = await duffel.seatMaps.get({ offer_id: offerId });

    // Duffel SDK returns { data: [...], meta: {...}, status: 200 }
    // response.data is the array of seat map objects
    const seatMaps = Array.isArray(response.data) ? response.data : [];

    if (seatMaps.length === 0) {
      // This is normal — most airlines don't expose seat maps via Duffel,
      // and Duffel sandbox only supports seat maps for specific test carriers.
      // Log a warning so it's visible in server logs, but DO NOT throw.
      const logger = require("../../config/logger");
      logger.warn(
        `[SeatMap] Duffel returned empty seat map for offer ${offerId}. ` +
          `The airline may not support seat map data, or this offer uses a ` +
          `carrier not enabled for seat maps in ${process.env.NODE_ENV} mode.`,
      );
    }

    return seatMaps;
  } catch (err) {
    // Duffel returns 422 with code "seat_map_not_available" for unsupported airlines.
    // We normalise and rethrow so the caller (service layer) can decide whether
    // to surface this as an error or degrade gracefully.
    const logger = require("../../config/logger");
    logger.warn(`[SeatMap] Duffel error for offer ${offerId}:`, {
      message: err.message,
      errors: err.errors,
    });
    throw normalizeDuffelError(err);
  }
}

// ── ORDER CANCELLATION ─────────────────────────────────────────────────────────────
async function createCancellation(orderId) {
  try {
    const response = await duffel.orderCancellations.create({
      order_id: orderId,
    });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function confirmCancellation(cancellationId) {
  try {
    const response = await duffel.orderCancellations.confirm(cancellationId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getCancellation(cancellationId) {
  try {
    const response = await duffel.orderCancellations.get(cancellationId);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── ORDER CHANGE REQUESTS ─────────────────────────────────────────────────────────────
async function createOrderChangeRequest({ orderId, slices }) {
  try {
    const response = await duffel.orderChangeRequests.create({
      order_id: orderId,
      slices,
    });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getOrderChangeRequest(id) {
  try {
    const response = await duffel.orderChangeRequests.get(id);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── ORDER CHANGE OFFERS ─────────────────────────────────────────────────────────────
async function listOrderChangeOffers(orderChangeRequestId) {
  try {
    const offers = [];
    for await (const offer of duffel.orderChangeOffers.listWithGenerator({
      order_change_request_id: orderChangeRequestId,
    })) {
      offers.push(offer.data);
    }
    return offers;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getOrderChangeOffer(id) {
  try {
    const response = await duffel.orderChangeOffers.get(id);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ── ORDER CHANGES ─────────────────────────────────────────────────────────────
async function createOrderChange(selectedOrderChangeOfferID) {
  try {
    const response = await duffel.orderChanges.create({
      selected_order_change_offer: selectedOrderChangeOfferID,
    });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function confirmOrderChange(orderChangeId) {
  try {
    const response = await duffel.orderChanges.confirm(orderChangeId, {
      payment: { type: "balance" },
      amount: String(parseFloat(amount).toFixed(2)),
      currency,
    });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

module.exports = {
  createOfferRequest,
  getOfferRequest,
  listOffers,
  getOffer,
  createOrder,
  getOrder,
  updateOrder,
  getSeatMap,
  createCancellation,
  confirmCancellation,
  getCancellation,
  createOrderChangeRequest,
  getOrderChangeRequest,
  listOrderChangeOffers,
  getOrderChangeOffer,
  createOrderChange,
  confirmOrderChange,
};
