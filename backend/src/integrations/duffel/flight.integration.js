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
    };
    if (maxConnections !== undefined) params.max_connections = maxConnections;
    const response = await duffel.offers.list(params);
    const offers = [];
    for await (const offer of response) {
      offers.push(offer);
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
}) {
  try {
    const response = await duffel.orders.create({
      selected_offers: [selectedOfferId],
      passengers,
      payments,
      metadata,
    });
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
    return response.data;
  } catch (err) {
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
    const response = await duffel.orderChangeOffers.list({
      order_change_request_id: orderChangeRequestId,
    });
    const offers = [];
    for await (const offer of response) {
      offers.push(offer);
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
