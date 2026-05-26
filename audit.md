# OTA Travel Platform — Complete Backend Audit Report

> **Codebase:** `ota-travel-platform-backend` · Duffel SDK v4 · Supabase · Node 18+
> **Audited:** All 50+ source files across controllers, services, integrations, middleware, routes, database, helpers, config

---

## EXECUTIVE SUMMARY

Your backend is **architecturally sound and well-structured** — the separation of concerns (integrations → services → controllers → routes) is professional, the security model (RLS + CLS in Supabase, helmet, rate limiting, JWT rotation) is solid, and the Duffel migration SQL is thorough. However there are **4 critical bugs** that will crash the server on startup or at runtime in production, plus several important issues to fix before going live.

---

## ❶ — WHERE IS THE ENCRYPTED PASSWORD STORED?

**Short answer: Passwords are NOT stored in your database at all — this is correct.**

Here's the full picture:

| What                     | Where                                                   | How                                                        |
| ------------------------ | ------------------------------------------------------- | ---------------------------------------------------------- |
| **User password**        | Supabase `auth.users` table (internal, not your schema) | Bcrypt-hashed by Supabase Auth automatically               |
| **Passport number**      | `public.users.passport_number` (your schema)            | AES-256-GCM encrypted via `crypto.config.js` before insert |
| **Refresh token**        | `public.refresh_tokens.token_hash`                      | SHA-256 hashed, raw token never stored                     |
| **Password reset token** | `public.password_reset_tokens.token`                    | SHA-256 hashed, raw token sent only via email              |
| **Encryption key**       | `.env → ENCRYPTION_KEY` (or fallback to `JWT_SECRET`)   | Derived to 32 bytes via SHA-256                            |

**Issue with encryption key fallback:** In `crypto.config.js` you fall back to `JWT_SECRET` if `ENCRYPTION_KEY` is not set. This is a **security risk** — the same secret is used for both JWT signing and AES-256 encryption. If one is compromised, both are. Set a dedicated `ENCRYPTION_KEY` in production.

---

## ❷ — CRITICAL BUGS (Will Crash or Break in Production)

### 🔴 BUG 1: Server Crashes on Startup — Missing Route Files

**File:** `src/routes/index.js`
**Severity:** CRITICAL — server will not start

`index.js` references four route modules that **do not exist on disk:**

```js
router.use("/notifications", require("./notification.routes")); // ❌ FILE MISSING
router.use("/support", require("./support.routes")); // ❌ FILE MISSING
router.use("/meta", require("./supporting.routes")); // ❌ FILE MISSING
router.use("/admin", require("./admin/index.routes")); // ❌ FILE MISSING
```

Node's `require()` throws `MODULE_NOT_FOUND` synchronously at startup. The server will crash before accepting a single request.

**Fix:** Create stub files for each, or comment out the lines until the modules are built. Minimal stubs:

```js
// src/routes/notification.routes.js
const router = require("express").Router();
module.exports = router;
```

---

### 🔴 BUG 2: Syntax Error in Payment Routes — Server Crash

**File:** `src/routes/payment-webhook.routes.js` · Line ~37
**Severity:** CRITICAL — syntax error, server won't start

```js
// CURRENT (broken — .authenticate is a property access, not middleware)
paymentRouter.post(
  "/:bookingId/refund".authenticate, // ❌ String.authenticate = undefined
  [param("bookingId").isUUID(), validate],
  paymentController.refundPayment,
);
```

**Fix:**

```js
paymentRouter.post(
  "/:bookingId/refund", // ✅ separate string
  authenticate, // ✅ middleware
  [param("bookingId").isUUID(), validate],
  paymentController.refundPayment,
);
```

---

### 🔴 BUG 3: Typo in Logger Import — Crash at Runtime

**File:** `src/server.js` · Line 3
**Severity:** CRITICAL

```js
// CURRENT
const logger = require("./config/logger"); // ❌ file is logger.js (not exported as "logger")

// app.js correctly does:
const logger = require("./config/logger.config"); // ✅
```

Check your actual filename. One of these is wrong. Both files cannot both export a valid logger — one will silently be `{}` or crash. Standardize to one filename across all files.

---

### 🔴 BUG 4: Hotel Booking Update Uses Wrong ID Field

**File:** `src/services/stays.services.js` → `confirmHotelBooking()`
**Severity:** HIGH — hotel confirmations will silently fail to write the Duffel order ID

```js
// CURRENT (wrong — updates by hotel_booking.id, but bookingId is the bookings.id)
await supabaseAdmin
  .from("hotel_booking")
  .update({ duffel_order_id: duffelBooking.id, ... })
  .eq("id", bookingId);   // ❌ bookingId is from bookings table, not hotel_booking table
```

**Fix:**

```js
.eq("booking_id", bookingId);   // ✅ correct FK column
```

---

## ❸ — LOGICAL ERRORS

### 🟠 ISSUE 1: Payment Confirmation Race Condition

**File:** `src/services/payment.services.js` → `confirmPayment()`

When `provider === duffel` and no `PaymentIntentId` is provided (e.g., via webhook), the code marks payment as COMPLETED **without verifying** the Duffel payment intent status. It relies purely on the webhook being trusted. This is acceptable only if your Duffel webhook signature check is always enforced. Currently the signature check is **skipped** when `config.duffel.webhookSecret` is empty (allowed in dev). Ensure production always sets `DUFFEL_WEBHOOK_SECRET`.

### 🟠 ISSUE 2: Reset Password — Wrong Column in Revoke Query

**File:** `src/services/auth.services.js` → `resetPassword()`

```js
// First revoke attempt uses wrong column (token vs token_hash)
await supabaseAdmin
  .from("refresh_tokens")
  .update({ revoked_at: ... })
  .eq("token", hash);     // ❌ the column is "token_hash", not "token"
```

The second bulk-revoke below it correctly uses `.eq("user_id", ...)`, so all tokens ARE eventually revoked — but the first targeted revoke silently fails.

### 🟠 ISSUE 3: Offer Expiry Check in Hotel Init Has a Logic Inversion

**File:** `src/services/stays.services.js` → `initHotelBooking()`

```js
if (quote.expires_at && new Date(quote.expires_at) < new Date()) {
  throw new AppError("This hotel rate has expired...");
}
```

This logic is correct, but `createQuote()` is called **before** this check, meaning you already paid the Duffel API call before validating expiry. Additionally the typo `"THis hotel rate"` should be `"This hotel rate"`.

### 🟠 ISSUE 4: JWT Expiry is 7 Days (Too Long for Access Token)

**File:** `src/config/app.config.js`

`JWT_EXPIRES_IN` defaults to `7d`. For an access token this is very long — if a token is stolen, the attacker has 7 days of access. Standard practice is 15–60 minutes for access tokens with refresh token rotation (which you do have). Recommended: set `JWT_EXPIRES_IN=15m` and rely on refresh.

### 🟠 ISSUE 5: `confirmFlightBooking` Status Never Updated to `CONFIRMED` in DB

**File:** `src/services/flight.services.js` → `confirmFlightBooking()`

The function creates the Duffel order and updates `flight_booking` with the order ID — but **never updates `bookings.status` to `CONFIRMED`**. The status update only happens in `payment.services.js → confirmPayment()`. This means if `confirmFlightBooking` is called directly (not via payment flow), the booking stays `PAYMENT_PROCESSING` forever.

### 🟠 ISSUE 6: Duffel Payment Intent Import Will Fail

**File:** `src/services/payment.services.js` · Line 13

```js
const { PaymentIntents } = require("@duffel/api/DuffelPayments"); // ❌ unused + likely wrong path
```

This import is never used and the module path is not standard for `@duffel/api` v4. Remove it or the build may fail depending on the package version.

### 🟠 ISSUE 7: `cancelled_At` Typo (Capital A)

**File:** `src/services/flight.services.js` → `cancelFlightBooking()`

```js
cancelled_At: new Date().toISOString(),   // ❌ capital A won't match DB column "cancelled_at"
```

The DB schema defines `cancelled_at` (lowercase). This update will be silently ignored by Supabase.

---

## ❹ — PRODUCTION SAFETY CHECKLIST

### 🟡 Things That Will Work Fine in Production

| Area                           | Status                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- |
| Duffel API integration         | ✅ Uses `duffel.offerRequests`, `duffel.offers`, `duffel.orders` correctly  |
| Duffel Managed Payments        | ✅ `PAYMENT_PROVIDER=duffel` → creates `payments.intents` via Duffel client |
| Webhook signature verification | ✅ Both Stripe and Duffel verify HMAC signatures                            |
| Password handling              | ✅ Supabase Auth hashes passwords — you never touch them                    |
| PII encryption                 | ✅ Passport numbers AES-256-GCM encrypted at rest                           |
| Refresh token rotation         | ✅ Old token revoked, new one issued on every refresh                       |
| RLS + CLS in Supabase          | ✅ Comprehensive — anon has zero access                                     |
| Rate limiting                  | ✅ Global + per-endpoint limiters in place                                  |
| CORS                           | ✅ Allowlist-based, not wildcard                                            |
| Helmet headers                 | ✅ XSS/CSP/HSTS protection active                                           |
| Error handling                 | ✅ Global error handler, no stack traces leaked in prod                     |
| Hotel search polling           | ✅ Correctly polls up to 15× every 2s for `completed` status                |
| Booking reference uniqueness   | ✅ UUIDs + random suffix, collision risk negligible                         |
| Activity + booking logs        | ✅ Immutable audit trail for all state changes                              |

### 🔴 Things That Will Break in Production

| Issue                                     | Fix                                                            |
| ----------------------------------------- | -------------------------------------------------------------- |
| Missing 4 route files                     | Create stubs immediately                                       |
| Syntax error in payment routes            | Fix the `.authenticate` string concatenation                   |
| Logger import inconsistency               | Standardize `logger.js` vs `logger.config.js`                  |
| Hotel confirm writes wrong column         | `.eq("booking_id", bookingId)`                                 |
| No `ENCRYPTION_KEY` in prod               | Set dedicated env var, separate from `JWT_SECRET`              |
| Duffel webhook secret not enforced in dev | OK for dev, but verify `DUFFEL_WEBHOOK_SECRET` is set for prod |

---

## ❺ — MISSING OTA FEATURES (Not Yet Implemented)

These are features a production OTA would typically have that are missing or stubbed:

| Feature                          | Status     | Notes                                                                 |
| -------------------------------- | ---------- | --------------------------------------------------------------------- |
| Multi-city flight search         | 🟡 Partial | Route accepts it but no dedicated UI/validator path                   |
| Seat selection on booking        | 🟡 Partial | `getSeatMap` exists, but seat selection not passed into `createOrder` |
| Ancillary services (bags, meals) | ❌ Missing | Duffel supports `services` on orders                                  |
| Loyalty program / wallet         | ❌ Missing | No points/miles tracking                                              |
| Email verification resend        | ❌ Missing | `forgot-password` resends, but no `/resend-verification` endpoint     |
| Admin dashboard routes           | ❌ Missing | `admin.services.js` exists but `admin/index.routes` file is missing   |
| Notification routes              | ❌ Missing | Controller exists, route file missing                                 |
| Support ticket routes            | ❌ Missing | Service/controller exist, route file missing                          |
| Price alerts / watch             | ❌ Missing | Common OTA feature                                                    |
| Saved/favorite trips             | ❌ Missing | Common OTA feature                                                    |

---

## ❻ — DUFFEL MANAGED PAYMENTS VERIFICATION

Your code correctly implements Duffel Managed Payments for production:

```
PAYMENT_PROVIDER=duffel (set in .env for production)
    ↓
initiatePayment() → duffel.payments.intents.create({ amount, currency })
    ↓ returns clientKey to frontend
frontend → Duffel.js component collects card details
    ↓ Duffel fires webhook: payment_intent.succeeded
webhook handler → confirmPayment() → confirmProviderBooking()
    ↓
confirmFlightBooking() → duffel.orders.create({ payments: [{ type: "balance" }] })
```

This flow is correct. The `payments: [{ type: "balance" }]` tells Duffel to charge from your Duffel balance (funded by the customer's payment intent). ✅

---

---

# POSTMAN TESTING GUIDE

## Setup

### Environment Variables

Create a Postman environment called **OTA-Local** with these variables:

| Variable         | Initial Value                            |
| ---------------- | ---------------------------------------- |
| `base_url`       | `http://localhost:5000/api/v1`           |
| `token`          | _(leave blank — auto-filled by scripts)_ |
| `refreshToken`   | _(leave blank — auto-filled)_            |
| `bookingId`      | _(leave blank — auto-filled)_            |
| `offerId`        | _(leave blank — auto-filled)_            |
| `offerRequestId` | _(leave blank — auto-filled)_            |

---

### Postman Pre-Request / Test Scripts (Collection Level)

Paste this as the **Collection-level Tests script** — it auto-saves tokens from auth responses:

```javascript
// PASTE THIS IN: Collection → Tests tab
const json = pm.response.json();

if (json?.data?.token) {
  pm.environment.set("token", json.data.token);
  console.log("✅ Access token saved");
}
if (json?.data?.refreshToken) {
  pm.environment.set("refreshToken", json.data.refreshToken);
  console.log("✅ Refresh token saved");
}
if (json?.data?.bookingId) {
  pm.environment.set("bookingId", json.data.bookingId);
  console.log("✅ BookingId saved:", json.data.bookingId);
}
if (json?.data?.offers?.[0]?.offerId) {
  pm.environment.set("offerId", json.data.offers[0].offerId);
  console.log("✅ First offerId saved:", json.data.offers[0].offerId);
}
if (json?.data?.offerRequestId) {
  pm.environment.set("offerRequestId", json.data.offerRequestId);
}
```

---

## SECTION A — Authentication

### A1. Register

- **Method:** POST
- **URL:** `{{base_url}}/auth/register`
- **Body (JSON):**

```json
{
  "email": "testuser@example.com",
  "password": "Test@1234!",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+919876543210",
  "dateOfBirth": "1990-05-15",
  "nationality": "IN",
  "passportNumber": "P1234567"
}
```

- **Expected:** 201 · `{ token, refreshToken, user }`
- **Test Script:**

```javascript
pm.test("Register success", () => {
  pm.response.to.have.status(201);
  const json = pm.response.json();
  pm.expect(json.data).to.have.property("token");
  pm.environment.set("token", json.data.token);
  pm.environment.set("refreshToken", json.data.refreshToken);
});
```

---

### A2. Verify Email

After registering, check your email for the verification token (or query `email_verification_tokens` in Supabase dashboard).

- **Method:** GET
- **URL:** `{{base_url}}/auth/verify-email?token=PASTE_TOKEN_HERE`
- **Expected:** 200 · `{ verified: true }`

---

### A3. Login

- **Method:** POST
- **URL:** `{{base_url}}/auth/login`
- **Body (JSON):**

```json
{
  "email": "testuser@example.com",
  "password": "Test@1234!"
}
```

- **Expected:** 200 · `{ token, refreshToken, user, roles }`
- **Test Script:**

```javascript
pm.test("Login success", () => {
  pm.response.to.have.status(200);
  const d = pm.response.json().data;
  pm.environment.set("token", d.token);
  pm.environment.set("refreshToken", d.refreshToken);
  console.log("Logged in as:", d.user.email);
});
```

---

### A4. Get My Profile

- **Method:** GET
- **URL:** `{{base_url}}/auth/me`
- **Headers:** `Authorization: Bearer {{token}}`
- **Expected:** 200 · user profile object

---

### A5. Update My Profile

- **Method:** PATCH
- **URL:** `{{base_url}}/auth/me`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON):**

```json
{
  "firstName": "Johnny",
  "phone": "+919999999999"
}
```

- **Expected:** 200 · updated user object

---

### A6. Refresh Token

- **Method:** POST
- **URL:** `{{base_url}}/auth/refresh`
- **Body (JSON):**

```json
{
  "refreshToken": "{{refreshToken}}"
}
```

- **Expected:** 200 · `{ token, refreshToken }` (new pair)

---

### A7. Forgot Password

- **Method:** POST
- **URL:** `{{base_url}}/auth/forgot-password`
- **Body (JSON):**

```json
{
  "email": "testuser@example.com"
}
```

- **Expected:** 200 · always returns success (anti-enumeration)

---

### A8. Reset Password

Get the reset token from `password_reset_tokens` in Supabase dashboard (the raw token is emailed; the DB stores the SHA-256 hash).

- **Method:** POST
- **URL:** `{{base_url}}/auth/reset-password`
- **Body (JSON):**

```json
{
  "token": "RAW_TOKEN_FROM_EMAIL",
  "newPassword": "NewPass@5678!"
}
```

- **Expected:** 200 · `{ reset: true }`

---

### A9. Logout

- **Method:** POST
- **URL:** `{{base_url}}/auth/logout`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON):**

```json
{
  "refreshToken": "{{refreshToken}}"
}
```

- **Expected:** 200 · `"Logged out successfully."`

---

## SECTION B — Flights

### B1. Search Flights (One-Way)

- **Method:** POST
- **URL:** `{{base_url}}/flights/search`
- **Body (JSON):**

```json
{
  "origin": "DEL",
  "destination": "BOM",
  "departureDate": "2026-07-15",
  "adults": 1,
  "children": 0,
  "infants": 0,
  "cabinClass": "economy"
}
```

- **Expected:** 200 · `{ offerRequestId, totalOffers, offers: [...] }`
- **Test Script:**

```javascript
pm.test("Flight search returns offers", () => {
  pm.response.to.have.status(200);
  const d = pm.response.json().data;
  pm.environment.set("offerRequestId", d.offerRequestId);
  if (d.offers && d.offers.length > 0) {
    pm.environment.set("offerId", d.offers[0].offerId);
    console.log(
      "First offer:",
      d.offers[0].offerId,
      "Price:",
      d.offers[0].totalAmount,
      d.offers[0].totalCurrency,
    );
  }
});
```

---

### B2. Search Flights (Round-Trip)

- **Method:** POST
- **URL:** `{{base_url}}/flights/search`
- **Body (JSON):**

```json
{
  "origin": "DEL",
  "destination": "LHR",
  "departureDate": "2026-08-01",
  "returnDate": "2026-08-15",
  "adults": 2,
  "cabinClass": "business",
  "sortBy": "total_amount"
}
```

- **Expected:** 200 · offers with 2 slices each

---

### B3. Search Flights (With Filters)

- **Method:** POST
- **URL:** `{{base_url}}/flights/search`
- **Body (JSON):**

```json
{
  "origin": "BOM",
  "destination": "SIN",
  "departureDate": "2026-07-20",
  "adults": 1,
  "cabinClass": "economy",
  "maxStops": 1,
  "maxPrice": 50000,
  "sortBy": "stops"
}
```

---

### B4. List Offers (Paginated Re-fetch)

- **Method:** GET
- **URL:** `{{base_url}}/flights/offers?offerRequestId={{offerRequestId}}&sortBy=total_amount`
- **Expected:** 200 · offers array

---

### B5. Get Single Offer Details

- **Method:** GET
- **URL:** `{{base_url}}/flights/offers/{{offerId}}`
- **Expected:** 200 · offer with seat map data

---

### B6. Get Seat Map

- **Method:** GET
- **URL:** `{{base_url}}/flights/offers/{{offerId}}/seat-map`
- **Expected:** 200 · seat map array (may be empty for some airlines)

---

### B7. Initialize Flight Booking (Auth Required)

- **Method:** POST
- **URL:** `{{base_url}}/flights/book`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON):**

```json
{
  "offerId": "{{offerId}}",
  "tripType": "ONE_WAY",
  "passengers": [
    {
      "firstName": "John",
      "lastName": "Doe",
      "bornOn": "1990-05-15",
      "gender": "male",
      "nationality": "IN",
      "passportNumber": "P1234567",
      "passportExpiry": "2030-01-01",
      "email": "john.doe@example.com",
      "phone": "+919876543210",
      "passengerType": "adult"
    }
  ]
}
```

- **Expected:** 200 · `{ bookingId, bookingRef, amount, currency, offerExpiresAt }`
- **Test Script:**

```javascript
pm.test("Booking initialized", () => {
  pm.response.to.have.status(200);
  const d = pm.response.json().data;
  pm.environment.set("bookingId", d.bookingId);
  console.log(
    "BookingID:",
    d.bookingId,
    "Ref:",
    d.bookingRef,
    "Amount:",
    d.amount,
    d.currency,
  );
});
```

---

### B8. Get Flight Booking

- **Method:** GET
- **URL:** `{{base_url}}/flights/bookings/{{bookingId}}`
- **Headers:** `Authorization: Bearer {{token}}`
- **Expected:** 200 · booking with flight_booking and travelers joined

---

### B9. List My Flight Bookings

- **Method:** GET
- **URL:** `{{base_url}}/flights/bookings?page=1&limit=10`
- **Headers:** `Authorization: Bearer {{token}}`
- **Expected:** 200 · `{ bookings, total, page, limit }`

---

### B10. List My Bookings (Filter by Status)

- **Method:** GET
- **URL:** `{{base_url}}/flights/bookings?status=PENDING_PAYMENT`
- **Headers:** `Authorization: Bearer {{token}}`

---

### B11. Initiate Payment (Flight)

Run this **after B7**.

- **Method:** POST
- **URL:** `{{base_url}}/payments/initiate`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON):**

```json
{
  "bookingId": "{{bookingId}}"
}
```

- **Expected (Stripe mode):** 200 · `{ provider: "stripe", sessionId, sessionUrl, publishableKey }`
- **Expected (Duffel mode):** 200 · `{ provider: "duffel", PaymentIntentId, clientKey }`
- **Test Script:**

```javascript
pm.test("Payment initiated", () => {
  pm.response.to.have.status(200);
  const d = pm.response.json().data;
  console.log("Payment provider:", d.provider);
  if (d.sessionId) pm.environment.set("stripeSessionId", d.sessionId);
  if (d.PaymentIntentId)
    pm.environment.set("duffelPaymentIntentId", d.PaymentIntentId);
});
```

---

### B12. Confirm Payment (After Stripe/Duffel Payment)

- **Method:** POST
- **URL:** `{{base_url}}/payments/confirm`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON) — Stripe flow:**

```json
{
  "bookingId": "{{bookingId}}",
  "sessionId": "{{stripeSessionId}}"
}
```

- **Body (JSON) — Duffel flow:**

```json
{
  "bookingId": "{{bookingId}}",
  "PaymentIntentId": "{{duffelPaymentIntentId}}"
}
```

- **Expected:** 200 · `{ bookingId, bookingRef, status: "CONFIRMED" }`

---

### B13. Get Payment Status

- **Method:** GET
- **URL:** `{{base_url}}/payments/{{bookingId}}/status`
- **Headers:** `Authorization: Bearer {{token}}`
- **Expected:** 200 · `{ bookingId, bookStatus, payment, refund }`

---

### B14. Cancel Flight Booking

- **Method:** POST
- **URL:** `{{base_url}}/flights/bookings/{{bookingId}}/cancel`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body:** _(empty `{}`)_
- **Expected:** 200 · `{ bookingId, status: "CANCELLED", refundAmount, refundCurrency }`

---

### B15. Create Change Request

Requires a confirmed booking with a Duffel order.

- **Method:** POST
- **URL:** `{{base_url}}/flights/bookings/{{bookingId}}/change-request`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON):**

```json
{
  "slices": [
    {
      "slice_id": "DUFFEL_SLICE_ID_FROM_ORDER",
      "origin": "DEL",
      "destination": "BOM",
      "departure_date": "2026-09-01"
    }
  ]
}
```

---

### B16. Initiate Refund

- **Method:** POST
- **URL:** `{{base_url}}/payments/{{bookingId}}/refund`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON):**

```json
{
  "reason": "Change of plans"
}
```

- **Expected:** 200 · `{ bookingId, refundAmount, currency, status }`

---

## SECTION C — Hotels (Stays)

### C1. Search Hotels

- **Method:** POST
- **URL:** `{{base_url}}/stays/search`
- **Body (JSON):**

```json
{
  "latitude": 28.6139,
  "longitude": 77.209,
  "checkInDate": "2026-07-20",
  "checkOutDate": "2026-07-25",
  "rooms": 1,
  "guests": 2,
  "radius": 10
}
```

- **Note:** This endpoint polls Duffel up to 30 seconds. Be patient.
- **Expected:** 200 · `{ searchId, status: "completed", hotels: [...] }`
- **Test Script:**

```javascript
pm.test("Hotel search completed", () => {
  pm.response.to.have.status(200);
  const d = pm.response.json().data;
  pm.environment.set("hotelSearchId", d.searchId);
  if (d.hotels && d.hotels.length > 0) {
    const hotel = d.hotels[0];
    pm.environment.set("accommodationId", hotel.accommodationsId);
    const firstRate = hotel.rooms?.[0];
    if (firstRate) {
      pm.environment.set("rateId", firstRate.rateId);
      console.log(
        "Rate ID:",
        firstRate.rateId,
        "Price:",
        firstRate.totalAmount,
        firstRate.totalCurrency,
      );
    }
    console.log("Hotel:", hotel.name, "Stars:", hotel.starRating);
  }
});
```

---

### C2. Get Accommodation Details

- **Method:** GET
- **URL:** `{{base_url}}/stays/accommodations/{{accommodationId}}`
- **Expected:** 200 · full hotel object with amenities, photos, policies

---

### C3. Create Quote (Auth Required)

- **Method:** POST
- **URL:** `{{base_url}}/stays/quotes`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON):**

```json
{
  "rateId": "{{rateId}}"
}
```

- **Expected:** 200 · `{ quoteId, totalAmount, totalCurrency, checkInDate, checkOutDate, expiresAt }`
- **Test Script:**

```javascript
pm.test("Quote created", () => {
  pm.response.to.have.status(200);
  const d = pm.response.json().data;
  pm.environment.set("quoteId", d.quoteId);
  console.log(
    "Quote:",
    d.quoteId,
    "Amount:",
    d.totalAmount,
    d.totalCurrency,
    "Expires:",
    d.expiresAt,
  );
});
```

---

### C4. Initialize Hotel Booking (Auth Required)

- **Method:** POST
- **URL:** `{{base_url}}/stays/book`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON):**

```json
{
  "rateId": "{{rateId}}",
  "hotelId": "{{accommodationId}}",
  "hotelName": "Test Hotel Delhi",
  "checkInDate": "2026-07-20",
  "checkOutDate": "2026-07-25",
  "rooms": 1,
  "guests": 2
}
```

- **Expected:** 200 · `{ bookingId, bookingRef, quoteId, amount, currency }`
- **Test Script:**

```javascript
pm.test("Hotel booking initialized", () => {
  pm.response.to.have.status(200);
  const d = pm.response.json().data;
  pm.environment.set("hotelBookingId", d.bookingId);
  console.log("Hotel BookingID:", d.bookingId, "Ref:", d.bookingRef);
});
```

---

### C5. Initiate Payment (Hotel)

- **Method:** POST
- **URL:** `{{base_url}}/payments/initiate`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON):**

```json
{
  "bookingId": "{{hotelBookingId}}"
}
```

- **Expected:** 200 · payment session/intent

---

### C6. Confirm Hotel Booking (Auth Required)

- **Method:** POST
- **URL:** `{{base_url}}/stays/booking/{{hotelBookingId}}/confirm`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body (JSON):**

```json
{
  "guests": [
    {
      "given_name": "John",
      "family_name": "Doe",
      "born_on": "1990-05-15"
    },
    {
      "given_name": "Jane",
      "family_name": "Doe",
      "born_on": "1992-08-22"
    }
  ]
}
```

- **Expected:** 200 · `{ bookingId, bookingRef, duffelBookingId, status: "CONFIRMED" }`

---

### C7. Get Hotel Booking

- **Method:** GET
- **URL:** `{{base_url}}/stays/bookings/{{hotelBookingId}}`
- **Headers:** `Authorization: Bearer {{token}}`
- **Expected:** 200 · full booking with hotel_booking joined

---

### C8. List My Hotel Bookings

- **Method:** GET
- **URL:** `{{base_url}}/stays/bookings?page=1&limit=10`
- **Headers:** `Authorization: Bearer {{token}}`
- **Expected:** 200 · `{ bookings, total, page, limit }`

---

### C9. Cancel Hotel Booking

- **Method:** POST
- **URL:** `{{base_url}}/stays/bookings/{{hotelBookingId}}/cancel`
- **Headers:** `Authorization: Bearer {{token}}`
- **Body:** `{}`
- **Expected:** 200 · `{ bookingId, status: "CANCELLED" }`

---

## SECTION D — Health Check

### D1. Health

- **Method:** GET
- **URL:** `{{base_url}}/health`
- **Expected:** 200 · `{ status: "ok" }` (no auth required)

---

## COMPLETE POSTMAN COLLECTION SCRIPT

Paste this entire block into **Postman → Import → Raw Text** to create the full collection:

```json
{
  "info": {
    "name": "OTA Travel Platform",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    { "key": "base_url", "value": "http://localhost:5000/api/v1" },
    { "key": "token", "value": "" },
    { "key": "refreshToken", "value": "" },
    { "key": "bookingId", "value": "" },
    { "key": "offerId", "value": "" },
    { "key": "offerRequestId", "value": "" },
    { "key": "hotelBookingId", "value": "" },
    { "key": "accommodationId", "value": "" },
    { "key": "rateId", "value": "" }
  ],
  "event": [
    {
      "listen": "test",
      "script": {
        "type": "text/javascript",
        "exec": [
          "const json = pm.response.json();",
          "if (json?.data?.token) { pm.collectionVariables.set('token', json.data.token); }",
          "if (json?.data?.refreshToken) { pm.collectionVariables.set('refreshToken', json.data.refreshToken); }",
          "if (json?.data?.bookingId) { pm.collectionVariables.set('bookingId', json.data.bookingId); }",
          "if (json?.data?.hotelBookingId) { pm.collectionVariables.set('hotelBookingId', json.data.hotelBookingId); }",
          "if (json?.data?.offers?.[0]?.offerId) { pm.collectionVariables.set('offerId', json.data.offers[0].offerId); }",
          "if (json?.data?.offerRequestId) { pm.collectionVariables.set('offerRequestId', json.data.offerRequestId); }",
          "if (json?.data?.hotels?.[0]?.accommodationsId) { pm.collectionVariables.set('accommodationId', json.data.hotels[0].accommodationsId); }",
          "if (json?.data?.hotels?.[0]?.rooms?.[0]?.rateId) { pm.collectionVariables.set('rateId', json.data.hotels[0].rooms[0].rateId); }"
        ]
      }
    }
  ],
  "item": [
    {
      "name": "Auth",
      "item": [
        {
          "name": "Register",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/auth/register",
            "header": [{ "key": "Content-Type", "value": "application/json" }],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"testuser@example.com\",\n  \"password\": \"Test@1234!\",\n  \"firstName\": \"John\",\n  \"lastName\": \"Doe\",\n  \"phone\": \"+919876543210\",\n  \"dateOfBirth\": \"1990-05-15\",\n  \"nationality\": \"IN\",\n  \"passportNumber\": \"P1234567\"\n}"
            }
          }
        },
        {
          "name": "Login",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/auth/login",
            "header": [{ "key": "Content-Type", "value": "application/json" }],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"testuser@example.com\",\n  \"password\": \"Test@1234!\"\n}"
            }
          }
        },
        {
          "name": "Get Profile",
          "request": {
            "method": "GET",
            "url": "{{base_url}}/auth/me",
            "header": [{ "key": "Authorization", "value": "Bearer {{token}}" }]
          }
        },
        {
          "name": "Update Profile",
          "request": {
            "method": "PATCH",
            "url": "{{base_url}}/auth/me",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}" },
              { "key": "Content-Type", "value": "application/json" }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"firstName\": \"Johnny\"\n}"
            }
          }
        },
        {
          "name": "Refresh Token",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/auth/refresh",
            "header": [{ "key": "Content-Type", "value": "application/json" }],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"refreshToken\": \"{{refreshToken}}\"\n}"
            }
          }
        },
        {
          "name": "Forgot Password",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/auth/forgot-password",
            "header": [{ "key": "Content-Type", "value": "application/json" }],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"testuser@example.com\"\n}"
            }
          }
        },
        {
          "name": "Logout",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/auth/logout",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}" },
              { "key": "Content-Type", "value": "application/json" }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"refreshToken\": \"{{refreshToken}}\"\n}"
            }
          }
        }
      ]
    },
    {
      "name": "Flights",
      "item": [
        {
          "name": "Search Flights (One-Way)",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/flights/search",
            "header": [{ "key": "Content-Type", "value": "application/json" }],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"origin\": \"DEL\",\n  \"destination\": \"BOM\",\n  \"departureDate\": \"2026-07-15\",\n  \"adults\": 1,\n  \"cabinClass\": \"economy\"\n}"
            }
          }
        },
        {
          "name": "Search Flights (Round-Trip)",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/flights/search",
            "header": [{ "key": "Content-Type", "value": "application/json" }],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"origin\": \"DEL\",\n  \"destination\": \"LHR\",\n  \"departureDate\": \"2026-08-01\",\n  \"returnDate\": \"2026-08-15\",\n  \"adults\": 1,\n  \"cabinClass\": \"economy\"\n}"
            }
          }
        },
        {
          "name": "List Offers",
          "request": {
            "method": "GET",
            "url": {
              "raw": "{{base_url}}/flights/offers?offerRequestId={{offerRequestId}}&sortBy=total_amount",
              "query": [
                { "key": "offerRequestId", "value": "{{offerRequestId}}" },
                { "key": "sortBy", "value": "total_amount" }
              ]
            }
          }
        },
        {
          "name": "Get Offer Details",
          "request": {
            "method": "GET",
            "url": "{{base_url}}/flights/offers/{{offerId}}"
          }
        },
        {
          "name": "Get Seat Map",
          "request": {
            "method": "GET",
            "url": "{{base_url}}/flights/offers/{{offerId}}/seat-map"
          }
        },
        {
          "name": "Initialize Flight Booking",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/flights/book",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}" },
              { "key": "Content-Type", "value": "application/json" }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"offerId\": \"{{offerId}}\",\n  \"tripType\": \"ONE_WAY\",\n  \"passengers\": [\n    {\n      \"firstName\": \"John\",\n      \"lastName\": \"Doe\",\n      \"bornOn\": \"1990-05-15\",\n      \"gender\": \"male\",\n      \"nationality\": \"IN\",\n      \"passportNumber\": \"P1234567\",\n      \"passportExpiry\": \"2030-01-01\",\n      \"email\": \"john.doe@example.com\",\n      \"phone\": \"+919876543210\",\n      \"passengerType\": \"adult\"\n    }\n  ]\n}"
            }
          }
        },
        {
          "name": "Initiate Payment",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/payments/initiate",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}" },
              { "key": "Content-Type", "value": "application/json" }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"bookingId\": \"{{bookingId}}\"\n}"
            }
          }
        },
        {
          "name": "Confirm Payment",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/payments/confirm",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}" },
              { "key": "Content-Type", "value": "application/json" }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"bookingId\": \"{{bookingId}}\",\n  \"sessionId\": \"STRIPE_SESSION_ID_HERE\"\n}"
            }
          }
        },
        {
          "name": "Get Flight Booking",
          "request": {
            "method": "GET",
            "url": "{{base_url}}/flights/bookings/{{bookingId}}",
            "header": [{ "key": "Authorization", "value": "Bearer {{token}}" }]
          }
        },
        {
          "name": "List My Bookings",
          "request": {
            "method": "GET",
            "url": "{{base_url}}/flights/bookings?page=1&limit=10",
            "header": [{ "key": "Authorization", "value": "Bearer {{token}}" }]
          }
        },
        {
          "name": "Cancel Flight Booking",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/flights/bookings/{{bookingId}}/cancel",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}" },
              { "key": "Content-Type", "value": "application/json" }
            ],
            "body": { "mode": "raw", "raw": "{}" }
          }
        },
        {
          "name": "Get Payment Status",
          "request": {
            "method": "GET",
            "url": "{{base_url}}/payments/{{bookingId}}/status",
            "header": [{ "key": "Authorization", "value": "Bearer {{token}}" }]
          }
        }
      ]
    },
    {
      "name": "Hotels (Stays)",
      "item": [
        {
          "name": "Search Hotels",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/stays/search",
            "header": [{ "key": "Content-Type", "value": "application/json" }],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"latitude\": 28.6139,\n  \"longitude\": 77.2090,\n  \"checkInDate\": \"2026-07-20\",\n  \"checkOutDate\": \"2026-07-25\",\n  \"rooms\": 1,\n  \"guests\": 2,\n  \"radius\": 10\n}"
            }
          }
        },
        {
          "name": "Get Accommodation Details",
          "request": {
            "method": "GET",
            "url": "{{base_url}}/stays/accommodations/{{accommodationId}}"
          }
        },
        {
          "name": "Create Quote",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/stays/quotes",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}" },
              { "key": "Content-Type", "value": "application/json" }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"rateId\": \"{{rateId}}\"\n}"
            }
          }
        },
        {
          "name": "Initialize Hotel Booking",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/stays/book",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}" },
              { "key": "Content-Type", "value": "application/json" }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"rateId\": \"{{rateId}}\",\n  \"hotelId\": \"{{accommodationId}}\",\n  \"hotelName\": \"Test Hotel Delhi\",\n  \"checkInDate\": \"2026-07-20\",\n  \"checkOutDate\": \"2026-07-25\",\n  \"rooms\": 1,\n  \"guests\": 2\n}"
            }
          }
        },
        {
          "name": "Confirm Hotel Booking",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/stays/booking/{{hotelBookingId}}/confirm",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}" },
              { "key": "Content-Type", "value": "application/json" }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"guests\": [\n    {\n      \"given_name\": \"John\",\n      \"family_name\": \"Doe\",\n      \"born_on\": \"1990-05-15\"\n    }\n  ]\n}"
            }
          }
        },
        {
          "name": "Get Hotel Booking",
          "request": {
            "method": "GET",
            "url": "{{base_url}}/stays/bookings/{{hotelBookingId}}",
            "header": [{ "key": "Authorization", "value": "Bearer {{token}}" }]
          }
        },
        {
          "name": "List My Hotel Bookings",
          "request": {
            "method": "GET",
            "url": "{{base_url}}/stays/bookings?page=1&limit=10",
            "header": [{ "key": "Authorization", "value": "Bearer {{token}}" }]
          }
        },
        {
          "name": "Cancel Hotel Booking",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/stays/bookings/{{hotelBookingId}}/cancel",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}" },
              { "key": "Content-Type", "value": "application/json" }
            ],
            "body": { "mode": "raw", "raw": "{}" }
          }
        }
      ]
    },
    {
      "name": "Health",
      "item": [
        {
          "name": "Health Check",
          "request": { "method": "GET", "url": "{{base_url}}/health" }
        }
      ]
    }
  ]
}
```

---

## RECOMMENDED TESTING ORDER

```
1.  Health Check (D1) — confirm server is up
2.  Register (A1) — create user
3.  Verify Email (A2) — confirm email from Supabase dashboard
4.  Login (A3) — get token (auto-saved)
5.  Get Profile (A4) — confirm auth works
6.  Search Flights (B1) — get offerRequestId + offerId (auto-saved)
7.  Get Offer Details (B5) — inspect one offer
8.  Init Flight Booking (B7) — bookingId auto-saved
9.  Initiate Payment (B11) — get sessionId
10. Confirm Payment (B12) — confirm booking
11. Get Booking (B8) — verify CONFIRMED status
12. Search Hotels (C1) — accommodationId + rateId auto-saved
13. Get Accommodation (C2) — hotel details
14. Create Quote (C3) — quoteId
15. Init Hotel Booking (C4) — hotelBookingId auto-saved
16. Confirm Hotel Booking (C6)
17. Cancel Hotel Booking (C9)
18. Cancel Flight Booking (B14)
19. Logout (A9)
```

---

_Audit completed. Fix the 4 critical bugs before any production deployment._
