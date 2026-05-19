/\*\*

- src/routes/index.js
-
- WHY A CENTRAL ROUTER?
- Instead of mounting every route directly in app.js (which gets messy fast),
- we have ONE file that registers all route modules. app.js stays clean.
-
- Route versioning (/api/v1/) is important for OTAs and any public API:
- - Allows you to make breaking changes in /v2 without breaking /v1 clients
- - Clients (mobile apps) update slowly — you can't just change the API
-
- As we build more modules (auth, flights, bookings, payments),
- we add them here in one line each.
  \*/

"use strict";

const express = require("express");
const router = express.Router();

// ── Route modules (add as we build each phase) ────────────────────────────────
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");
const flightRoutes = require("./flight.routes");
// Phase 3: const flightRoutes = require('./flight.routes');
// Phase 4: const paymentRoutes = require('./payment.routes');
// Phase 5: const bookingRoutes = require('./booking.routes');
// Phase 6: const adminRoutes = require('./admin.routes');
// Phase 7: const hotelRoutes = require('./hotel.routes');
// Phase 7: const carRoutes = require('./car.routes');

// ── Mount routes ──────────────────────────────────────────────────────────────
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/flights", flightRoutes);
// router.use('/flights', flightRoutes);
// router.use('/payments', paymentRoutes);
// router.use('/bookings', bookingRoutes);
// router.use('/admin', adminRoutes);
// router.use('/hotels', hotelRoutes);
// router.use('/cars', carRoutes);

module.exports = router;
