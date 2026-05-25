"use strict";

const duffel = require("../../config/duffel");
const { normalizeDuffelError } = require("../../helpers/booking.helper");
const STANDARD_EVENTS = [
  "order.updated",
  "order.airline_initiated_change",
  "payment_intent.payment_failed",
  "stays.booking.updated",
];

// ──── WEBHOOKS ──────────────────────────────────────────────────────────────
async function createWebhook({ url, events, active }) {
  try {
    const response = await duffel.webhooks.create({ url, events, active });
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function listWebhooks() {
  try {
    const response = await duffel.webhooks.list();
    const items = [];
    for await (const item of response) items.push(item);
    return items;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getWebhook(id) {
  try {
    const response = await duffel.webhooks.get(id);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function updateWebhook(id, { url, events, active }) {
  try {
    const payload = {};
    if (url !== undefined) payload.url = url;
    if (events !== undefined) payload.events = events;
    if (active !== undefined) payload.active = active;
    const response = await duffel.webhooks.update(id, payload);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function deleteWebhook(id) {
  try {
    await duffel.webhooks.delete(id);
    return { deleted: true, id };
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function pingWebhook(id) {
  try {
    const response = await duffel.webhooks.ping(id);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

// ──── WEBHOOKS DELIVERIES ──────────────────────────────────────────────────────────────
async function listWebhookDeliveries(webhookId) {
  try {
    const response = await duffel.webhookDeliveries.list({
      webhook_id: webhookId,
    });
    const items = [];
    for await (const item of response) items.push(item);
    return items;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

async function getWebhookDelivery(id) {
  try {
    const response = await duffel.webhookDeliveries.get(id);
    return response.data;
  } catch (err) {
    throw normalizeDuffelError(err);
  }
}

module.exports = {
  STANDARD_EVENTS,
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  pingWebhook,
  listWebhookDeliveries,
  getWebhookDelivery,
};
