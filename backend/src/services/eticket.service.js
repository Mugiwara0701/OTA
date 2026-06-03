"use strict";

/**
 * E-Ticket Generator Service
 *
 * Builds a professional PDF e-ticket from a confirmed flight booking.
 * Uses PDFKit (pure Node.js, no external process needed).
 *
 * Install dependency:
 *   npm install pdfkit qrcode
 */

const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { decrypt } = require("../config/crypto.config");

// ─── Brand colours (matches your dark theme in email templates) ───────────────
const BRAND = {
  purple: "#6C3CE1",
  purpleLight: "#9B5CFF",
  dark: "#0D0B1E",
  card: "#1A1730",
  border: "#2D2850",
  white: "#FFFFFF",
  muted: "#A0A0C0",
  dimmed: "#6B6B8E",
};

// ─── Layout constants ─────────────────────────────────────────────────────────
const PAGE_W = 595.28; // A4 width  (pts)
const PAGE_H = 841.89; // A4 height (pts)
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function formatDateOnly(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDuration(dur) {
  if (!dur) return "—";
  // PT7H30M → "7h 30m"
  const match = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return dur;
  const h = match[1] ? `${match[1]}h` : "";
  const m = match[2] ? `${match[2]}m` : "";
  return [h, m].filter(Boolean).join(" ");
}

// ─── Section renderers ────────────────────────────────────────────────────────

/** Solid-filled rectangle helper */
function fillRect(doc, x, y, w, h, color) {
  doc.save().rect(x, y, w, h).fill(color).restore();
}

/** Rounded rect (PDFKit doesn't have native roundedRect in older versions) */
function roundedRect(doc, x, y, w, h, r, color) {
  doc.save().roundedRect(x, y, w, h, r).fill(color).restore();
}

/** Draw a thin horizontal divider */
function divider(doc, y, color = BRAND.border) {
  doc
    .save()
    .moveTo(MARGIN, y)
    .lineTo(PAGE_W - MARGIN, y)
    .strokeColor(color)
    .lineWidth(0.5)
    .stroke()
    .restore();
}

/** Key / value row inside a card */
function kv(doc, x, y, key, value, valueColor = BRAND.white) {
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(BRAND.muted)
    .text(key, x, y, { width: 120 });
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(valueColor)
    .text(value || "—", x + 130, y, { width: CONTENT_W - 130 - 10 });
  return y + 18;
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

/**
 * generateETicketPDF
 *
 * @param {Object} booking   - Row from `bookings` table
 * @param {Object} flightBooking - Row from `flight_booking` table (pnr, duffel_order_id…)
 * @param {Object} order     - Mapped Duffel order (mapDuffelOrder output)
 * @param {Object} user      - { first_name, last_name, email }
 * @param {Object[]} travelers - Array of traveler rows
 * @returns {Promise<Buffer>} - PDF as a Buffer
 */
async function generateETicketPDF({
  booking,
  flightBooking,
  order,
  user,
  travelers,
}) {
  // ── 1. Build QR code data (PNR + booking ref) ──────────────────────────────
  const qrData = JSON.stringify({
    ref: booking.booking_ref,
    pnr: flightBooking?.pnr || order?.bookingReference || "—",
    id: booking.id,
  });
  const qrDataUrl = await QRCode.toDataURL(qrData, {
    width: 120,
    margin: 1,
    color: { dark: "#6C3CE1", light: "#FFFFFF" },
  });
  // Convert data URL to Buffer for pdfkit
  const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
  const qrBuffer = Buffer.from(qrBase64, "base64");

  // ── 2. Create PDF document ─────────────────────────────────────────────────
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: {
      Title: `E-Ticket ${booking.booking_ref}`,
      Author: "Wanderly",
      Subject: "Flight E-Ticket",
      Creator: "Wanderly Booking Platform",
    },
  });

  // Collect output into a buffer
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  await new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);

    let y = MARGIN;

    // ── HEADER BAR ────────────────────────────────────────────────────────────
    fillRect(doc, 0, 0, PAGE_W, 80, BRAND.dark);

    // Gradient simulation: two overlapping rects (pdfkit doesn't do gradients natively)
    fillRect(doc, 0, 0, PAGE_W / 2, 80, BRAND.purple);
    fillRect(doc, PAGE_W / 2, 0, PAGE_W / 2, 80, BRAND.purpleLight);

    // Brand name
    doc
      .font("Helvetica-Bold")
      .fontSize(22)
      .fillColor(BRAND.white)
      .text("✈ Wanderly", MARGIN, 24);

    // E-TICKET label
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("rgba(255,255,255,0.85)")
      .text("ELECTRONIC TICKET", PAGE_W - MARGIN - 140, 20, {
        align: "right",
        width: 140,
      });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("rgba(255,255,255,0.65)")
      .text("Issued by Wanderly Travel", PAGE_W - MARGIN - 140, 36, {
        align: "right",
        width: 140,
      });

    y = 100;

    // ── BOOKING REF CARD ──────────────────────────────────────────────────────
    roundedRect(doc, MARGIN, y, CONTENT_W, 64, 8, BRAND.card);
    doc
      .save()
      .roundedRect(MARGIN, y, CONTENT_W, 64, 8)
      .strokeColor(BRAND.border)
      .lineWidth(1)
      .stroke()
      .restore();

    // PNR
    const pnr = flightBooking?.pnr || order?.bookingReference || "N/A";
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text("PNR / Airline Reference", MARGIN + 16, y + 12);
    doc
      .font("Helvetica-Bold")
      .fontSize(22)
      .fillColor(BRAND.purpleLight)
      .text(pnr, MARGIN + 16, y + 25);

    // Booking Ref
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text("Booking Reference", MARGIN + 220, y + 12);
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(BRAND.white)
      .text(booking.booking_ref, MARGIN + 220, y + 28);

    // Status badge
    const statusColor =
      booking.status === "confirmed" ? "#4CAF50" : BRAND.purpleLight;
    roundedRect(
      doc,
      PAGE_W - MARGIN - 100,
      y + 16,
      84,
      22,
      11,
      statusColor + "22",
    );
    doc
      .save()
      .roundedRect(PAGE_W - MARGIN - 100, y + 16, 84, 22, 11)
      .strokeColor(statusColor)
      .lineWidth(0.8)
      .stroke()
      .restore();
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(statusColor)
      .text(
        (booking.status || "CONFIRMED").toUpperCase(),
        PAGE_W - MARGIN - 96,
        y + 22,
        { width: 76, align: "center" },
      );

    y += 80;

    // ── FLIGHT SEGMENTS ───────────────────────────────────────────────────────
    const slices = order?.slices || [];
    slices.forEach((slice, sliceIdx) => {
      const segments = slice.segments || [];

      // Slice header
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(BRAND.purpleLight)
        .text(
          `FLIGHT ${sliceIdx + 1}  ·  ${slice.origin?.iataCode || "—"} → ${slice.destination?.iataCode || "—"}`,
          MARGIN,
          y,
        );
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(BRAND.muted)
        .text(formatDateOnly(slice.departureAt), MARGIN + 220, y);
      y += 18;

      segments.forEach((seg, segIdx) => {
        // Segment card
        roundedRect(doc, MARGIN, y, CONTENT_W, 90, 6, BRAND.card);
        doc
          .save()
          .roundedRect(MARGIN, y, CONTENT_W, 90, 6)
          .strokeColor(BRAND.border)
          .lineWidth(0.5)
          .stroke()
          .restore();

        // Airline + flight number
        const airline = seg.marketingCarrier?.name || "—";
        const flightNo = `${seg.marketingCarrier?.iataCode || ""}${seg.marketingCarrierFlightNumber || ""}`;
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor(BRAND.white)
          .text(flightNo, MARGIN + 12, y + 10);
        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor(BRAND.muted)
          .text(airline, MARGIN + 12, y + 26);

        // Aircraft
        if (seg.aircraft?.name) {
          doc
            .font("Helvetica")
            .fontSize(8)
            .fillColor(BRAND.dimmed)
            .text(seg.aircraft.name, MARGIN + 12, y + 40);
        }

        // DEP / ARR block
        const col1 = MARGIN + 120;
        const col2 = MARGIN + 280;

        // DEP
        doc
          .font("Helvetica-Bold")
          .fontSize(20)
          .fillColor(BRAND.white)
          .text(seg.origin?.iataCode || "—", col1, y + 8);
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(BRAND.muted)
          .text(seg.origin?.cityName || seg.origin?.name || "", col1, y + 32, {
            width: 100,
          });
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor(BRAND.purpleLight)
          .text(
            new Date(seg.departingAt).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "UTC",
            }),
            col1,
            y + 46,
          );
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(BRAND.muted)
          .text(formatDateOnly(seg.departingAt), col1, y + 60);

        // Duration + arrow
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(BRAND.muted)
          .text(formatDuration(seg.duration), col1 + 72, y + 28, {
            width: 60,
            align: "center",
          });
        doc
          .save()
          .moveTo(col1 + 68, y + 40)
          .lineTo(col1 + 132, y + 40)
          .strokeColor(BRAND.border)
          .lineWidth(1)
          .stroke()
          .restore();
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor(BRAND.muted)
          .text("→", col1 + 125, y + 34);

        // ARR
        doc
          .font("Helvetica-Bold")
          .fontSize(20)
          .fillColor(BRAND.white)
          .text(seg.destination?.iataCode || "—", col2, y + 8);
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(BRAND.muted)
          .text(
            seg.destination?.cityName || seg.destination?.name || "",
            col2,
            y + 32,
            { width: 100 },
          );
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor(BRAND.purpleLight)
          .text(
            new Date(seg.arrivingAt).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "UTC",
            }),
            col2,
            y + 46,
          );
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(BRAND.muted)
          .text(formatDateOnly(seg.arrivingAt), col2, y + 60);

        // Terminal info
        if (seg.originTerminal) {
          doc
            .font("Helvetica")
            .fontSize(7)
            .fillColor(BRAND.dimmed)
            .text(`Terminal ${seg.originTerminal}`, col1, y + 74);
        }
        if (seg.destinationTerminal) {
          doc
            .font("Helvetica")
            .fontSize(7)
            .fillColor(BRAND.dimmed)
            .text(`Terminal ${seg.destinationTerminal}`, col2, y + 74);
        }

        y += 98;

        // ── Seat info per passenger ──────────────────────────────────────────
        const passengersWithSeats = (seg.passengers || []).filter(
          (p) => p.seat?.designator,
        );
        if (passengersWithSeats.length > 0) {
          passengersWithSeats.forEach((pax, pi) => {
            const traveler = travelers?.[pi];
            const name = traveler
              ? `${traveler.first_name} ${traveler.last_name}`
              : `Passenger ${pi + 1}`;
            doc
              .font("Helvetica")
              .fontSize(8)
              .fillColor(BRAND.muted)
              .text(
                `${name}  ·  Seat ${pax.seat.designator}  ·  ${pax.cabinClass?.replace("_", " ") || ""}`,
                MARGIN + 16,
                y,
                { width: CONTENT_W - 32 },
              );
            y += 13;
          });
          y += 4;
        }
      });

      y += 8;
    });

    // ── PASSENGER LIST ────────────────────────────────────────────────────────
    if (travelers && travelers.length > 0) {
      y += 4;
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(BRAND.purpleLight)
        .text("PASSENGERS", MARGIN, y);
      y += 14;

      roundedRect(
        doc,
        MARGIN,
        y,
        CONTENT_W,
        travelers.length * 28 + 16,
        6,
        BRAND.card,
      );
      doc
        .save()
        .roundedRect(MARGIN, y, CONTENT_W, travelers.length * 28 + 16, 6)
        .strokeColor(BRAND.border)
        .lineWidth(0.5)
        .stroke()
        .restore();

      y += 10;
      travelers.forEach((t, idx) => {
        const dob = t.date_of_birth ? formatDateOnly(t.date_of_birth) : null;
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor(BRAND.white)
          .text(`${idx + 1}.  ${t.first_name} ${t.last_name}`, MARGIN + 12, y);
        if (t.passport_number) {
          const passportDisplay =
            decrypt(t.passport_number) ?? t.passport_number;
          doc
            .font("Helvetica")
            .fontSize(8)
            .fillColor(BRAND.muted)
            .text(`Passport: ${passportDisplay}`, MARGIN + 200, y + 2);
        }
        if (dob) {
          doc
            .font("Helvetica")
            .fontSize(8)
            .fillColor(BRAND.muted)
            .text(`DOB: ${dob}`, MARGIN + 340, y + 2);
        }
        y += 28;
      });
      y += 4;
    }

    // ── PAYMENT SUMMARY ───────────────────────────────────────────────────────
    y += 8;
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(BRAND.purpleLight)
      .text("PAYMENT SUMMARY", MARGIN, y);
    y += 14;

    roundedRect(doc, MARGIN, y, CONTENT_W, 72, 6, BRAND.card);
    doc
      .save()
      .roundedRect(MARGIN, y, CONTENT_W, 72, 6)
      .strokeColor(BRAND.border)
      .lineWidth(0.5)
      .stroke()
      .restore();

    y += 12;
    y = kv(
      doc,
      MARGIN + 16,
      y,
      "Total Paid",
      `${booking.currency} ${parseFloat(booking.total_amount || 0).toFixed(2)}`,
      BRAND.purpleLight,
    );
    y = kv(doc, MARGIN + 16, y, "Payment Status", "Paid in Full", "#4CAF50");
    y = kv(doc, MARGIN + 16, y, "Booking Date", formatDate(booking.created_at));
    y += 8;

    // ── QR CODE + notice ──────────────────────────────────────────────────────
    y += 8;
    // QR on the right
    doc.image(qrBuffer, PAGE_W - MARGIN - 100, y, { width: 100, height: 100 });

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(BRAND.white)
      .text("Scan QR at check-in", PAGE_W - MARGIN - 100, y + 104, {
        width: 100,
        align: "center",
      });

    // Notice text
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(BRAND.white)
      .text("Important Information", MARGIN, y);
    y += 14;
    const notices = [
      "• Please arrive at the airport at least 2 hours before departure for domestic flights and 3 hours for international flights.",
      "• This e-ticket serves as your travel document. Present it at check-in along with a valid government-issued photo ID.",
      "• Baggage allowances are subject to the airline's policy. Please verify before travelling.",
      "• For any changes or cancellations, log in to your Wanderly account or contact support.",
    ];
    notices.forEach((line) => {
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(BRAND.muted)
        .text(line, MARGIN, y, { width: CONTENT_W - 120 });
      y += 14;
    });

    // ── FOOTER ────────────────────────────────────────────────────────────────
    fillRect(doc, 0, PAGE_H - 40, PAGE_W, 40, BRAND.card);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(BRAND.dimmed)
      .text(
        `© ${new Date().getFullYear()} Wanderly  ·  This is an automatically generated document  ·  ${booking.booking_ref}`,
        MARGIN,
        PAGE_H - 26,
        { width: CONTENT_W, align: "center" },
      );

    doc.end();
  });

  return Buffer.concat(chunks);
}

module.exports = { generateETicketPDF };
