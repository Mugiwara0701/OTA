"use strict";

const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/supporting.controller");

// Places autocomplete (used for flight/stay search)
// GET /api/v1/meta/places/search?q=London
router.get("/places/search", ctrl.searchPlaces);

// Airports
// GET /api/v1/meta/airports?country=GB&iata=LHR
router.get("/airports", ctrl.listAirports);
// GET /api/v1/meta/airports/:id
router.get("/airports/:id", ctrl.getAirport);

// Airlines
// GET /api/v1/meta/airlines?iata=BA
router.get("/airlines", ctrl.listAirlines);
// GET /api/v1/meta/airlines/:id
router.get("/airlines/:id", ctrl.getAirline);

// Aircraft
// GET /api/v1/meta/aircraft
router.get("/aircraft", ctrl.listAircraft);

// Cities
// GET /api/v1/meta/cities?country=GB
router.get("/cities", ctrl.listCities);

// Loyalty programmes
// GET /api/v1/meta/loyalty-programmes
router.get("/loyalty-programmes", ctrl.listLoyaltyProgrammes);

module.exports = router;
