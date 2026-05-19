"use strict";

function generateBookingRef(type = "FLT") {
  const now = new Date();
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate().padStart(2, "0")),
  ].join("");

  const random = Math.random().toString(36).substring(2, 6).toUpperCase();

  return `OTA-${type}-${dateStr}-${random}`;
}

function extractTotalPrice(flightOffer) {
  const raw =
    flightOffer?.price?.grandTotal || flightOffer?.price?.total || "0";

  return parseFloat(raw);
}

function extractCurrency(flightOffer) {
  return flightOffer?.price?.currency || "USD";
}

function flightSummary(flightOffer) {
  const segments = flightOffer?.itineraries?.[0]?.segments || [];
  const first = segments[0];
  const last = segments[segments.length - 1];

  return {
    origin: first?.departure?.iatacode || null,
    destination: last?.arrival?.iatacode || null,
    deapartureAt: first?.departure?.at || null,
    arrivalAt: last?.arrival?.at || null,
    carrier: first?.carrierCode || null,
    stops: segments.length - 1,
    totalPrice: extractTotalPrice(flightOffer),
    currency: extractCurrency(flightOffer),
  };
}

function formatDuration(isoDuration) {
  if (!isoDuration) return null;
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return isoDuration;
  const h = match[1] ? `${match[1]}h` : "";
  const m = match[2] ? `${match[2]}m` : "";
  return [h, m].filter(Boolean).join(" ");
}

function buildMeta(data = {}) {
  return { ...data, timestamp: new Date().toISOString() };
}

module.exports = {
  generateBookingRef,
  extractTotalPrice,
  extractCurrency,
  flightSummary,
  formatDuration,
  buildMeta,
};
