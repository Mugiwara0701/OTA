"use strict";

// ── BOOKING REFERENCE GENERATOR ───────────────────────────────────────────────
function generateBookingRef(type = "FLT") {
  const now = new Date();
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `OTA-${type}-${dateStr}-${random}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Map a Duffel airport object to a clean shape */
function _mapAirport(ap) {
  if (!ap) return null;
  return {
    id: ap.id,
    iataCode: ap.iata_code,
    icaoCode: ap.icao_code ?? null,
    name: ap.name,
    cityName: ap.city_name ?? null,
    cityIataCode: ap.iata_city_code ?? null,
    countryCode: ap.iata_country_code ?? null,
    timeZone: ap.time_zone ?? null,
    latitude: ap.latitude ?? null,
    longitude: ap.longitude ?? null,
  };
}

/** Map a Duffel carrier/airline object */
function _mapCarrier(c) {
  if (!c) return null;
  return {
    id: c.id,
    iataCode: c.iata_code,
    name: c.name,
    logoUrl: c.logo_symbol_url ?? null,
    logoLockupUrl: c.logo_lockup_url ?? null,
    conditionsOfCarriageUrl: c.conditions_of_carriage_url ?? null,
  };
}

/** Map intermediate stops within a segment */
function _mapStop(stop) {
  if (!stop) return null;
  return {
    id: stop.id,
    duration: stop.duration,
    departingAt: stop.departing_at,
    arrivingAt: stop.arriving_at,
    airport: _mapAirport(stop.airport),
  };
}

/** Map cabin amenities (wifi, seat, power) */
function _mapAmenities(amenities) {
  if (!amenities) return null;
  return {
    wifi: amenities.wifi
      ? { available: amenities.wifi.available, cost: amenities.wifi.cost }
      : null,
    seat: amenities.seat
      ? {
          type: amenities.seat.type,
          pitch: amenities.seat.pitch,
          legroom: amenities.seat.legroom,
        }
      : null,
    power: amenities.power ? { available: amenities.power.available } : null,
  };
}

/** Map passenger-level data inside a segment (cabin, baggages, seat, fare) */
function _mapSegmentPassenger(p) {
  return {
    passengerId: p.passenger_id,
    fareBasisCode: p.fare_basis_code ?? null,
    cabinClass: p.cabin_class,
    cabinClassMarketingName: p.cabin_class_marketing_name ?? null,
    // cabin includes amenities — only present on offers, not orders
    cabin: p.cabin
      ? {
          name: p.cabin.name,
          marketingName: p.cabin.marketing_name ?? null,
          amenities: _mapAmenities(p.cabin.amenities),
        }
      : null,
    baggages: (p.baggages || []).map((b) => ({
      type: b.type,
      quantity: b.quantity,
    })),
    // seat is only present on confirmed orders
    seat: p.seat
      ? {
          designator: p.seat.designator,
          name: p.seat.name ?? null,
          disclosures: p.seat.disclosures || [],
        }
      : null,
  };
}

/** Map a flight segment (shared between offer and order slices) */
function _mapSegment(seg) {
  return {
    id: seg.id,
    origin: _mapAirport(seg.origin),
    originTerminal: seg.origin_terminal ?? null,
    destination: _mapAirport(seg.destination),
    destinationTerminal: seg.destination_terminal ?? null,
    departingAt: seg.departing_at,
    arrivingAt: seg.arriving_at,
    duration: seg.duration,
    distance: seg.distance ?? null,
    aircraft: seg.aircraft
      ? { name: seg.aircraft.name, iataCode: seg.aircraft.iata_code }
      : null,
    marketingCarrier: _mapCarrier(seg.marketing_carrier),
    marketingCarrierFlightNumber: seg.marketing_carrier_flight_number ?? null,
    operatingCarrier: _mapCarrier(seg.operating_carrier),
    operatingCarrierFlightNumber: seg.operating_carrier_flight_number ?? null,
    // intermediate stops (connecting airports within one segment)
    stops: (seg.stops || []).map(_mapStop),
    passengers: (seg.passengers || []).map(_mapSegmentPassenger),
  };
}

/** Map conditions for a slice (change penalty) */
function _mapSliceConditions(cond) {
  if (!cond) return null;
  const change = cond.change_before_departure || {};
  return {
    changeable: change.allowed ?? null,
    changePenaltyAmount: change.penalty_amount ?? null,
    changePenaltyCurrency: change.penalty_currency ?? null,
    // slice-level perks (only on offers)
    priorityCheckIn: cond.priority_check_in ?? null,
    priorityBoarding: cond.priority_boarding ?? null,
    advanceSeatSelection: cond.advance_seat_selection ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFER REQUEST MAPPER
// Maps the Duffel offerRequest response (the search session object)
// Fields: id, slices, cabin_class, passengers, live_mode, created_at, client_key
// ─────────────────────────────────────────────────────────────────────────────
function mapDuffelOfferRequest(orq) {
  if (!orq) return null;
  return {
    offerRequestId: orq.id,
    liveMode: orq.live_mode,
    createdAt: orq.created_at,
    cabinClass: orq.cabin_class,
    // client_key is used by Duffel's Components SDK — pass through to frontend
    clientKey: orq.client_key ?? null,
    slices: (orq.slices || []).map((s) => ({
      origin: _mapAirport(s.origin),
      destination: _mapAirport(s.destination),
      departureDate: s.departure_date,
      originType: s.origin_type,
      destinationType: s.destination_type,
    })),
    passengers: (orq.passengers || []).map((p) => ({
      id: p.id ?? null,
      type: p.type,
      age: p.age ?? null,
      givenName: p.given_name ?? null,
      familyName: p.family_name ?? null,
      loyaltyProgrammeAccounts: (p.loyalty_programme_accounts || []).map(
        (lp) => ({
          airlineIataCode: lp.airline_iata_code,
          accountNumber: lp.account_number,
        }),
      ),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFER MAPPER
// Maps a full Duffel offer object — used in search results and offer detail
// ─────────────────────────────────────────────────────────────────────────────
function mapDuffelOffer(offer) {
  if (!offer) return null;

  // ── Conditions ─────────────────────────────────────────────────────────────
  const refundCond = offer.conditions?.refund_before_departure || {};
  const changeCond = offer.conditions?.change_before_departure || {};

  // ── Slices ─────────────────────────────────────────────────────────────────
  const slices = (offer.slices || []).map((slice) => ({
    sliceId: slice.id,
    origin: _mapAirport(slice.origin),
    destination: _mapAirport(slice.destination),
    originType: slice.origin_type ?? null,
    destinationType: slice.destination_type ?? null,
    departureAt: slice.segments?.[0]?.departing_at ?? null,
    arrivalAt: slice.segments?.[slice.segments.length - 1]?.arriving_at ?? null,
    duration: slice.duration,
    fareBrandName: slice.fare_brand_name ?? null,
    // ngs_shelf is Duffel's quality tier (1=basic, 2=standard, 3=premium)
    ngsShelf: slice.ngs_shelf ?? null,
    // comparison_key groups equivalent slices across offers
    comparisonKey: slice.comparison_key ?? null,
    conditions: _mapSliceConditions(slice.conditions),
    segments: (slice.segments || []).map(_mapSegment),
    // total stops = sum of intermediate stops across all segments
    stops: (slice.segments || []).reduce(
      (n, seg) => n + (seg.stops?.length || 0),
      0,
    ),
    // connections = number of segments minus 1 (layovers, not intermediate stops)
    connections: Math.max((slice.segments || []).length - 1, 0),
  }));

  // ── Passengers ─────────────────────────────────────────────────────────────
  const passengers = (offer.passengers || []).map((p) => ({
    id: p.id,
    type: p.type,
    age: p.age ?? null,
    givenName: p.given_name ?? null,
    familyName: p.family_name ?? null,
    fareType: p.fare_type ?? null,
    loyaltyProgrammeAccounts: (p.loyalty_programme_accounts || []).map(
      (lp) => ({
        airlineIataCode: lp.airline_iata_code,
        accountNumber: lp.account_number,
      }),
    ),
    // baggages at passenger level (included allowance)
    baggages: (p.baggages || []).map((b) => ({
      type: b.type,
      quantity: b.quantity,
    })),
  }));

  return {
    offerId: offer.id,
    liveMode: offer.live_mode ?? null,
    createdAt: offer.created_at ?? null,
    expiresAt: offer.expires_at,
    // partial=true means the offer may be missing some information
    partial: offer.partial ?? null,

    // ── Pricing ───────────────────────────────────────────────────────────────
    pricing: {
      baseAmount: offer.base_amount ?? null,
      baseCurrency: offer.base_currency ?? null,
      taxAmount: offer.tax_amount ?? null,
      taxCurrency: offer.tax_currency ?? null,
      totalAmount: offer.total_amount,
      totalCurrency: offer.total_currency,
      totalEmissionsKg: offer.total_emissions_kg ?? null,
    },

    // ── Booking conditions / policies ─────────────────────────────────────────
    conditions: {
      refundable: refundCond.allowed ?? false,
      refundPenaltyAmount: refundCond.penalty_amount ?? null,
      refundPenaltyCurrency: refundCond.penalty_currency ?? null,
      changeable: changeCond.allowed ?? false,
      changePenaltyAmount: changeCond.penalty_amount ?? null,
      changePenaltyCurrency: changeCond.penalty_currency ?? null,
    },

    // ── Payment requirements ───────────────────────────────────────────────────
    // Tells you if instant payment is needed vs hold is allowed
    paymentRequirements: offer.payment_requirements
      ? {
          requiresInstantPayment:
            offer.payment_requirements.requires_instant_payment ?? false,
          priceGuaranteeExpiresAt:
            offer.payment_requirements.price_guarantee_expires_at ?? null,
          paymentRequiredBy:
            offer.payment_requirements.payment_required_by ?? null,
        }
      : null,

    // ── Identity document requirements ────────────────────────────────────────
    passengerIdentityDocumentsRequired:
      offer.passenger_identity_documents_required ?? null,
    supportedPassengerIdentityDocumentTypes:
      offer.supported_passenger_identity_document_types ?? [],
    supportedLoyaltyProgrammes: offer.supported_loyalty_programmes ?? [],

    // ── Owner airline ─────────────────────────────────────────────────────────
    owner: _mapCarrier(offer.owner),

    // ── Available add-on services (extra bags, etc.) ───────────────────────────
    availableServices: (offer.available_services || []).map((svc) => ({
      id: svc.id,
      type: svc.type,
      totalAmount: svc.total_amount,
      totalCurrency: svc.total_currency,
      maximumQuantity: svc.maximum_quantity ?? null,
      passengerIds: svc.passenger_ids || [],
      segmentIds: svc.segment_ids || [],
    })),

    // ── Intended services (pre-selected services) ─────────────────────────────
    intendedServices: (offer.intended_services || []).map((svc) => ({
      id: svc.id,
      quantity: svc.quantity,
    })),

    // ── Airline credit IDs ─────────────────────────────────────────────────────
    availableAirlineCreditIds: offer.available_airline_credit_ids ?? [],

    // ── Private / corporate fares ─────────────────────────────────────────────
    privateFares: (offer.private_fares || []).map((pf) => ({
      type: pf.type,
      corporateCode: pf.corporate_code ?? null,
      trackingReference: pf.tracking_reference ?? null,
      tourCode: pf.tour_code ?? null,
    })),

    slices,
    passengers,

    // Backward-compat flat fields (kept so existing consumers don't break)
    totalAmount: offer.total_amount,
    totalCurrency: offer.total_currency,
    baseAmount: offer.base_amount ?? null,
    baseCurrency: offer.base_currency ?? null,
    taxAmount: offer.tax_amount ?? null,
    taxCurrency: offer.tax_currency ?? null,
    refundable: refundCond.allowed ?? false,
    changeable: changeCond.allowed ?? false,
    cabinClass: offer.cabin_class ?? null,
    owner_flat: _mapCarrier(offer.owner), // alias used internally
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDER MAPPER
// Maps a confirmed Duffel order — the full post-booking object
// ─────────────────────────────────────────────────────────────────────────────
function mapDuffelOrder(order) {
  if (!order) return null;

  const refundCond = order.conditions?.refund_before_departure || {};
  const changeCond = order.conditions?.change_before_departure || {};

  const slices = (order.slices || []).map((slice) => ({
    sliceId: slice.id,
    origin: _mapAirport(slice.origin),
    destination: _mapAirport(slice.destination),
    originType: slice.origin_type ?? null,
    destinationType: slice.destination_type ?? null,
    departureAt: slice.segments?.[0]?.departing_at ?? null,
    arrivalAt: slice.segments?.[slice.segments.length - 1]?.arriving_at ?? null,
    duration: slice.duration,
    fareBrandName: slice.fare_brand_name ?? null,
    conditions: _mapSliceConditions(slice.conditions),
    segments: (slice.segments || []).map(_mapSegment),
    stops: (slice.segments || []).reduce(
      (n, seg) => n + (seg.stops?.length || 0),
      0,
    ),
    connections: Math.max((slice.segments || []).length - 1, 0),
  }));

  return {
    // ── Identifiers ───────────────────────────────────────────────────────────
    orderId: order.id,
    offerId: order.offer_id ?? null,
    bookingReference: order.booking_reference ?? null,
    bookingReferences: (order.booking_references || []).map((br) => ({
      reference: br.booking_reference,
      carrier: _mapCarrier(br.carrier),
    })),

    // ── Status & lifecycle ────────────────────────────────────────────────────
    type: order.type, // "instant" | "hold"
    content: order.content ?? null, // "self-managed" | "managed"
    liveMode: order.live_mode,
    createdAt: order.created_at,
    syncedAt: order.synced_at ?? null,
    cancelledAt: order.cancelled_at ?? null,

    // ── Void window (free cancellation window) ────────────────────────────────
    voidWindowEndsAt: order.void_window_ends_at ?? null,

    // ── Payment status ────────────────────────────────────────────────────────
    paymentStatus: order.payment_status
      ? {
          awaitingPayment: order.payment_status.awaiting_payment ?? false,
          paidAt: order.payment_status.paid_at ?? null,
          paymentRequiredBy: order.payment_status.payment_required_by ?? null,
          priceGuaranteeExpiresAt:
            order.payment_status.price_guarantee_expires_at ?? null,
        }
      : null,

    // ── Pricing breakdown ─────────────────────────────────────────────────────
    pricing: {
      baseAmount: order.base_amount ?? null,
      baseCurrency: order.base_currency ?? null,
      taxAmount: order.tax_amount ?? null,
      taxCurrency: order.tax_currency ?? null,
      totalAmount: order.total_amount,
      currency: order.total_currency,
      totalEmissionsKg: order.total_emissions_kg ?? null,
    },

    // ── Booking conditions / refund & change policy ───────────────────────────
    conditions: {
      refundable: refundCond.allowed ?? false,
      refundPenaltyAmount: refundCond.penalty_amount ?? null,
      refundPenaltyCurrency: refundCond.penalty_currency ?? null,
      changeable: changeCond.allowed ?? false,
      changePenaltyAmount: changeCond.penalty_amount ?? null,
      changePenaltyCurrency: changeCond.penalty_currency ?? null,
    },

    // ── What the user/system can do next ──────────────────────────────────────
    availableActions: order.available_actions || [],

    // ── Owner airline ─────────────────────────────────────────────────────────
    owner: _mapCarrier(order.owner),

    // ── Passengers ────────────────────────────────────────────────────────────
    passengers: (order.passengers || []).map((p) => ({
      id: p.id,
      type: p.type,
      title: p.title ?? null,
      givenName: p.given_name,
      familyName: p.family_name,
      bornOn: p.born_on,
      gender: p.gender,
      email: p.email ?? null,
      phoneNumber: p.phone_number ?? null,
      infantPassengerId: p.infant_passenger_id ?? null,
      loyaltyProgrammeAccounts: (p.loyalty_programme_accounts || []).map(
        (lp) => ({
          airlineIataCode: lp.airline_iata_code,
          accountNumber: lp.account_number,
        }),
      ),
    })),

    // ── E-tickets and boarding passes ─────────────────────────────────────────
    documents: (order.documents || []).map((doc) => ({
      uniqueIdentifier: doc.unique_identifier,
      type: doc.type, // "electronic_ticket" | "boarding_pass"
      passengerIds: doc.passenger_ids || [],
    })),

    // ── Add-on services booked (seats, bags) ──────────────────────────────────
    services: (order.services || []).map((svc) => ({
      id: svc.id,
      type: svc.type, // "seat" | "baggage"
      totalAmount: svc.total_amount,
      totalCurrency: svc.total_currency,
      quantity: svc.quantity,
      passengerIds: svc.passenger_ids || [],
      segmentIds: svc.segment_ids || [],
      metadata: svc.metadata ?? null, // includes designator, name, disclosures for seats
    })),

    // ── Cancellation record (populated after cancel is requested) ─────────────
    cancellationInfo: order.cancellation
      ? {
          id: order.cancellation.id,
          orderId: order.cancellation.order_id,
          // refund_to: "arc_bsp_cash" | "voucher" | "awaiting_payment"
          refundTo: order.cancellation.refund_to,
          refundAmount: order.cancellation.refund_amount,
          refundCurrency: order.cancellation.refund_currency,
          liveMode: order.cancellation.live_mode,
          expiresAt: order.cancellation.expires_at ?? null,
          createdAt: order.cancellation.created_at,
          confirmedAt: order.cancellation.confirmed_at ?? null,
        }
      : null,

    // ── Changes history ───────────────────────────────────────────────────────
    changes: (order.changes || []).map((ch) => ({
      id: ch.id,
      orderId: ch.order_id ?? null,
      newTotalAmount: ch.new_total_amount ?? null,
      newTotalCurrency: ch.new_total_currency ?? null,
      changeTotalAmount: ch.change_total_amount ?? null,
      changeTotalCurrency: ch.change_total_currency ?? null,
      penaltyTotalAmount: ch.penalty_total_amount ?? null,
      penaltyTotalCurrency: ch.penalty_total_currency ?? null,
      refundTo: ch.refund_to ?? null,
      confirmedAt: ch.confirmed_at ?? null,
      createdAt: ch.created_at,
      expiresAt: ch.expires_at ?? null,
    })),

    // ── Airline-initiated changes (schedule changes pushed by airline) ─────────
    airlineInitiatedChanges: (order.airline_initiated_changes || []).map(
      (aic) => ({
        id: aic.id,
        orderId: aic.order_id ?? null,
        actionTaken: aic.action_taken ?? null,
        actionTakenAt: aic.action_taken_at ?? null,
        updatedAt: aic.updated_at ?? null,
        createdAt: aic.created_at,
        // ["accept", "cancel", "change"]
        availableActions: aic.available_actions || [],
        // added/removed slices from the airline's schedule change
        added: (aic.added || []).map((sl) => ({
          sliceId: sl.id,
          origin: _mapAirport(sl.origin),
          destination: _mapAirport(sl.destination),
          duration: sl.duration,
          fareBrandName: sl.fare_brand_name ?? null,
          segments: (sl.segments || []).map(_mapSegment),
        })),
        removed: (aic.removed || []).map((sl) => ({
          sliceId: sl.id,
          origin: _mapAirport(sl.origin),
          destination: _mapAirport(sl.destination),
          duration: sl.duration,
          fareBrandName: sl.fare_brand_name ?? null,
          segments: (sl.segments || []).map(_mapSegment),
        })),
      }),
    ),

    // ── Users with access to this order ──────────────────────────────────────
    users: order.users ?? [],

    // ── Custom metadata (booking_id, payment_intent_id etc.) ──────────────────
    metadata: order.metadata ?? null,

    slices,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT MAPPER
// Maps a Duffel payment record (balance, card, etc.)
// ─────────────────────────────────────────────────────────────────────────────
function mapDuffelPayment(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    orderId: payment.order_id,
    type: payment.type, // "balance" | "card" | "arc_bsp"
    status: payment.status, // "succeeded" | "failed" | "pending"
    amount: payment.amount,
    currency: payment.currency,
    liveMode: payment.live_mode,
    createdAt: payment.created_at,
    // only present when status = "failed"
    failureReason: payment.failure_reason ?? null,
    // only present when payment type uses an airline credit
    airlineCreditId: payment.airline_credit_id ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEAT MAP MAPPER
// Maps a Duffel seat map response to a clean renderable shape
// ─────────────────────────────────────────────────────────────────────────────
function mapDuffelSeatMap(seatMapList) {
  return (seatMapList || []).map((sm) => ({
    id: sm.id,
    segmentId: sm.segment_id,
    sliceId: sm.slice_id,
    cabins: (sm.cabins || []).map((cabin) => ({
      deck: cabin.deck,
      aisles: cabin.aisles,
      // wings: which rows are over the wings (for exit row context)
      wings: cabin.wings
        ? {
            firstRowIndex: cabin.wings.first_row_index,
            lastRowIndex: cabin.wings.last_row_index,
          }
        : null,
      rows: (cabin.rows || []).map((row, rowIndex) => ({
        rowIndex,
        sections: (row.sections || []).map((section) => ({
          elements: (section.elements || []).map((el) => {
            // Non-seat elements: exit_row, lavatory, galley, bassinet, empty
            if (el.type !== "seat") return { type: el.type };

            const hasServices =
              Array.isArray(el.available_services) &&
              el.available_services.length > 0;

            return {
              type: "seat",
              designator: el.designator,
              name: el.name || null,
              disclosures: el.disclosures || [],
              // available = passenger CAN still select this seat
              available: hasServices,
              services: hasServices
                ? el.available_services.map((s) => ({
                    id: s.id,
                    passengerId: s.passenger_id,
                    totalAmount: s.total_amount,
                    totalCurrency: s.total_currency,
                  }))
                : [],
            };
          }),
        })),
      })),
    })),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// HOTEL / STAYS MAPPERS (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
function mapDuffelHotelResult(result) {
  const acc = result.accommodation;
  return {
    resultId: result.id,
    expiresAt: result.expires_at,
    accommodationsId: acc?.id,
    name: acc?.name,
    description: acc?.description || null,
    starRating: acc?.rating,
    reviewScore: acc?.review_score,
    reviewCount: acc?.review_count || null,
    brand: acc?.brand?.name || null,
    phone: acc?.phone_number || null,
    email: acc?.email || null,
    address: acc?.location?.address || null,
    coordinates: acc?.location?.geographic_coordinates || null,
    checkInInfo: acc?.check_in_information || null,
    amenities: acc?.amenities || [],
    photos: acc?.photos || [],
    checkInDate: result.check_in_date,
    checkOutDate: result.check_out_date,
    rooms: result.rooms,
    guests: result.guests,
    cheapestRate: result.cheapest_rate_total_amount
      ? {
          totalAmount: result.cheapest_rate_total_amount,
          currency: result.cheapest_rate_currency,
          baseAmount: result.cheapest_rate_base_amount,
          baseCurrency: result.cheapest_rate_base_currency,
          dueAtAccommodation: result.cheapest_rate_due_at_accommodation_amount,
          dueAtAccommodationCurrency:
            result.cheapest_rate_due_at_accommodation_currency,
        }
      : null,
    roomRates: [],
  };
}

function mapDuffelRatePlan(rate) {
  return {
    rateId: rate.id,
    roomType: rate.accommodation_area?.name || rate.description,
    totalAmount: rate.total_amount,
    totalCurrency: rate.total_currency,
    cancellationTimeLine: rate.cancellation_timeline,
    boardType: rate.board_type,
    availableRooms: rate.available_quantity,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAR RENTAL MAPPER (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
function mapDuffelCarResult(result) {
  return {
    quoteId: result.id,
    carType: result.vehicle?.type,
    carCategory: result.vehicle?.category,
    make: result.vehicle?.make,
    model: result.vehicle?.model,
    seats: result.vehicle?.passenger_quantity,
    doors: result.vehicle?.door_count,
    transmission: result.vehicle?.transmission,
    airConditioned: result.vehicle?.air_conditioning,
    fuelPolicy: result.conditions?.fuel_policy,
    unlimitedMileage: result.conditions?.unlimited_mileage,
    pickupLocation: result.pickup_location,
    dropoffLocation: result.drop_off_locations,
    pickupAt: result.pick_up_date_time,
    dropoffAt: result.drop_off_date_time,
    totalAmount: result.total_amount,
    totalCurrency: result.total_currency,
    supplier: result.supplier?.name,
    photos: result.vehicle?.photos || [],
    includedExtras: result.included_services || [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
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

function normalizeDuffelError(err) {
  const { AppError } = require("../utils/AppError");
  const { HTTP } = require("../constants/index");
  const status = err?.response?.status || err?.statusCode;
  const duffelMessage =
    err?.errors?.[0]?.message || err?.message || "Duffel API ERROR";
  const map = {
    400: [HTTP.BAD_REQUEST, duffelMessage],
    401: [
      HTTP.BAD_GATEWAY,
      "Duffel authentication failed — check DUFFEL_ACCESS_TOKEN",
    ],
    404: [HTTP.NOT_FOUND, duffelMessage],
    422: [HTTP.UNPROCESSABLE, duffelMessage],
    429: [
      HTTP.TOO_MANY_REQUEST,
      "Duffel rate limit reached — please retry shortly",
    ],
    500: [HTTP.BAD_GATEWAY, "Duffel service error — please try again"],
    502: [HTTP.BAD_GATEWAY, "Duffel gateway error"],
  };
  const [code, message] = map[status] || [HTTP.BAD_GATEWAY, duffelMessage];
  return new AppError(message, code, { duffelErrors: err?.errors });
}

module.exports = {
  generateBookingRef,
  mapDuffelOfferRequest,
  mapDuffelOffer,
  mapDuffelOrder,
  mapDuffelPayment,
  mapDuffelSeatMap,
  mapDuffelHotelResult,
  mapDuffelRatePlan,
  mapDuffelCarResult,
  formatDuration,
  buildMeta,
  normalizeDuffelError,
};
