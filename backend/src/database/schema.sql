-- ═══════════════════════════════════════════════════════════════════════════════
-- OTA PLATFORM — COMPLETE DATABASE SCHEMA
-- PostgreSQL / Supabase
--
-- SECTIONS:
--   PART 0 — Extensions
--   PART 1 — Core Tables  (with FK constraints)
--   PART 2 — Reference Data Seed
--   PART 3 — Helper Functions  (used by RLS policies)
--   PART 4 — Row Level Security  (RLS)
--   PART 5 — Column Level Security  (CLS — GRANT / REVOKE)
--   PART 6 — Lock down anon role
--   PART 7 — Indexes
--   PART 8 — Triggers / Utility functions
--   PART 9 — Useful JOIN Views
--
-- SAFE TO RE-RUN: every statement uses IF NOT EXISTS / OR REPLACE / DROP IF EXISTS
-- SERVICE ROLE (your Express backend) always bypasses RLS — by design.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 0 — EXTENSIONS
-- ███████████████████████████████████████████████████████████████████████████████

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- uuid_generate_v4()


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 1 — CORE TABLES
-- ███████████████████████████████████████████████████████████████████████████████


-- ── 1.1  USERS ────────────────────────────────────────────────────────────────
--  Links to Supabase auth.users via auth_user_id (the JWT subject).
--  All other tables reference this table's `id` (not auth.users.id) so that
--  the application layer is decoupled from Supabase internals.

CREATE TABLE IF NOT EXISTS public.users (
  id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id              UUID        UNIQUE NOT NULL,   -- FK → auth.users.id
  email                     TEXT        UNIQUE NOT NULL,
  first_name                TEXT        NOT NULL,
  last_name                 TEXT        NOT NULL,
  phone                     TEXT        NOT NULL,
  date_of_birth             DATE        NOT NULL,
  nationality               TEXT        NOT NULL,
  passport_number           TEXT        UNIQUE NOT NULL,
  is_active                 BOOLEAN     NOT NULL DEFAULT true,
  duffel_customer_user_id   TEXT        UNIQUE,            -- Duffel Identity sync
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.users IS 'Application user profile — joined to auth.users via auth_user_id.';
COMMENT ON COLUMN public.users.auth_user_id IS 'Supabase auth.users.id — source of truth for the JWT uid().';
COMMENT ON COLUMN public.users.duffel_customer_user_id IS 'Duffel Identity customer user ID, populated after Phase 6 sync.';


-- ── EMAIL VERIFICATION TOKENS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_verification_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX email_verification_tokens_user_id_idx ON public.email_verification_tokens(user_id);
CREATE INDEX email_verification_tokens_token_idx ON public.email_verification_tokens(token);

COMMENT ON TABLE public.email_verification_tokens IS 'Email verification tokens sent during registration.';

-- ── 1.2  ROLES ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.roles (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        UNIQUE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.roles IS 'Static role catalogue: CUSTOMER, SALES, SUPPORT, ADMIN, SUPER_ADMIN.';


-- ── 1.3  USER_ROLES  (many-to-many) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_roles (
  id          SERIAL      PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  role_id     UUID        NOT NULL REFERENCES public.roles(id)  ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID        REFERENCES public.users(id),          -- which admin assigned
  UNIQUE (user_id, role_id)
);

COMMENT ON TABLE public.user_roles IS 'Many-to-many bridge: one user can hold multiple roles.';


-- ── 1.4  BOOKINGS  (master booking record) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bookings (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  booking_type        TEXT        NOT NULL CHECK (booking_type IN ('FLIGHT', 'HOTEL', 'CAR')),
  status              TEXT        NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (
    status IN (
      'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'CONFIRMED',
      'CANCELLED', 'REFUND_REQUESTED', 'REFUND_PROCESSING',
      'REFUNDED', 'FAILED'
    )
  ),
  total_amount        NUMERIC(12, 2) NOT NULL,
  currency            TEXT          NOT NULL DEFAULT 'USD',
  booking_ref         TEXT          UNIQUE NOT NULL,
  notes               TEXT,
  cancelled_at        TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.bookings IS 'Master booking record — parent of flight_booking / hotel_booking / car_booking.';
COMMENT ON COLUMN public.bookings.booking_ref IS 'Human-readable reference (e.g. OTA-20240001) — shown to the customer.';


-- ── 1.5  TRAVELERS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.travelers (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id      UUID        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  first_name      TEXT        NOT NULL,
  last_name       TEXT        NOT NULL,
  date_of_birth   DATE        NOT NULL,
  nationality     TEXT        NOT NULL,
  passport_number TEXT        UNIQUE NOT NULL,
  passport_expiry DATE        NOT NULL,
  gender          TEXT        NOT NULL CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
  travel_type     TEXT        NOT NULL CHECK (travel_type IN ('ADULT', 'CHILD', 'INFANT')),
  email           TEXT,
  phone           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.travelers IS 'Traveler PII for each passenger on a booking — FK to bookings.';


-- ── 1.6  FLIGHT_BOOKINGS ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.flight_booking (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id        UUID        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  -- Legacy Amadeus (kept for historical data)
  amadeus_order_id  TEXT,
  -- Duffel columns
  duffel_offer_id   TEXT,
  duffel_order_id   TEXT        UNIQUE,
  provider_order_id TEXT,
  provider          TEXT        NOT NULL DEFAULT 'duffel',
  -- Flight details
  pnr               TEXT,
  origin            TEXT        NOT NULL,
  destination       TEXT        NOT NULL,
  departure_time    TIMESTAMPTZ NOT NULL,
  return_date       TIMESTAMPTZ,
  trip_type         TEXT        NOT NULL CHECK (trip_type IN ('ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY')),
  cabin_class       TEXT        NOT NULL CHECK (cabin_class IN ('ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST')),
  carrier           TEXT        NOT NULL,
  offer_date        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.flight_booking IS 'Flight-specific booking details — child of bookings.';
COMMENT ON COLUMN public.flight_booking.duffel_order_id IS 'Duffel order ID returned after order creation.';
COMMENT ON COLUMN public.flight_booking.provider_order_id IS 'Internal gateway provider order ID — not exposed to customers.';


-- ── 1.7  HOTEL_BOOKINGS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_booking (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id        UUID        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  -- Legacy Amadeus
  amadeus_order_id  TEXT,
  -- Duffel columns
  duffel_offer_id   TEXT,
  duffel_quote_id   TEXT,
  duffel_order_id   TEXT        UNIQUE,
  provider_order_id TEXT,
  provider          TEXT        NOT NULL DEFAULT 'duffel',
  -- Hotel details
  hotel_id          TEXT        NOT NULL,
  hotel_name        TEXT        NOT NULL,
  check_in_date     DATE        NOT NULL,
  check_out_date    DATE        NOT NULL,
  room_type         TEXT,
  num_rooms         INTEGER     NOT NULL DEFAULT 1,
  num_guests        INTEGER     NOT NULL DEFAULT 1,
  offer_data        JSONB,                                 -- raw Duffel pricing — NOT exposed via CLS
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.hotel_booking IS 'Hotel/stay booking details — child of bookings.';
COMMENT ON COLUMN public.hotel_booking.offer_data IS 'Raw Duffel quote JSONB with rate breakdowns — never exposed to authenticated role.';


-- ── 1.8  CAR_BOOKINGS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.car_booking (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id        UUID        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  -- Legacy Amadeus
  amadeus_order_id  TEXT,
  -- Duffel columns
  duffel_offer_id   TEXT,
  duffel_quote_id   TEXT,
  duffel_order_id   TEXT        UNIQUE,
  provider_order_id TEXT,
  provider          TEXT        NOT NULL DEFAULT 'duffel',
  -- Car details
  pickup_location   TEXT        NOT NULL,
  dropoff_location  TEXT        NOT NULL,
  pickup_date       TIMESTAMPTZ NOT NULL,
  dropoff_date      TIMESTAMPTZ NOT NULL,
  car_type          TEXT,
  offer_data        JSONB,                                 -- NOT exposed via CLS
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.car_booking IS 'Car rental booking details — child of bookings.';


-- ── 1.9  PAYMENTS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payments (
  id                          UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id                  UUID           UNIQUE NOT NULL REFERENCES public.bookings(id)  ON DELETE CASCADE,
  user_id                     UUID           NOT NULL       REFERENCES public.users(id)       ON DELETE CASCADE,
  -- Provider discriminator
  payment_provider            TEXT           NOT NULL DEFAULT 'stripe'
                                             CHECK (payment_provider IN ('stripe', 'duffel')),
  -- Stripe columns (nullable when provider = duffel)
  stripe_session_id           TEXT           UNIQUE,
  stripe_payment_intent_id    TEXT           UNIQUE,
  stripe_charge_id            TEXT,
  -- Duffel columns (nullable when provider = stripe)
  duffel_payment_intent_id    TEXT           UNIQUE,
  duffel_client_key           TEXT,
  -- Common payment fields
  amount                      NUMERIC(12, 2) NOT NULL,
  currency                    TEXT           NOT NULL DEFAULT 'USD',
  status                      TEXT           NOT NULL DEFAULT 'PENDING' CHECK (
    status IN (
      'PENDING', 'PROCESSING', 'COMPLETED',
      'FAILED', 'REFUNDED', 'REFUND_PROCESSING'
    )
  ),
  payment_method              TEXT,
  paid_at                     TIMESTAMPTZ,
  meta_data                   JSONB,                       -- raw gateway response — NOT exposed via CLS
  created_at                  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.payments IS 'Payment record per booking — one-to-one via UNIQUE booking_id.';
COMMENT ON COLUMN public.payments.meta_data IS 'Raw gateway response payload — never exposed to authenticated role.';


-- ── 1.10  REFUNDS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.refunds (
  id                UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id        UUID           UNIQUE NOT NULL REFERENCES public.bookings(id)  ON DELETE CASCADE,
  payment_id        UUID           UNIQUE NOT NULL REFERENCES public.payments(id)  ON DELETE CASCADE,
  -- Provider discriminator
  payment_provider  TEXT           NOT NULL DEFAULT 'stripe',
  -- Stripe
  stripe_refund_id  TEXT           UNIQUE,
  -- Duffel
  duffel_refund_id  TEXT           UNIQUE,
  -- Common
  amount            NUMERIC(12, 2) NOT NULL,
  currency          TEXT           NOT NULL DEFAULT 'USD',
  reason            TEXT,
  status            TEXT           NOT NULL DEFAULT 'REQUESTED' CHECK (
    status IN ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED')
  ),
  requested_by      UUID           REFERENCES public.users(id),
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.refunds IS 'Refund record — one-to-one with booking and payment.';


-- ── 1.11  BOOKING_LOGS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.booking_logs (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id   UUID        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  action       TEXT        NOT NULL,
  old_status   TEXT,
  new_status   TEXT,
  message      TEXT,
  meta_data    JSONB,                    -- internal payload — NOT exposed via CLS
  performed_by UUID        REFERENCES public.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.booking_logs IS 'Immutable audit trail for every booking status change.';


-- ── 1.12  ACTIVITY_LOGS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  id_address  TEXT,        -- IP address — NOT exposed via CLS (typo kept for back-compat)
  user_agent  TEXT,        -- NOT exposed via CLS
  meta_data   JSONB,       -- NOT exposed via CLS
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.activity_logs IS 'Security-focused event log per user action.';


-- ── 1.13  NOTIFICATIONS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,
  title      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  is_read    BOOLEAN     NOT NULL DEFAULT false,
  meta_data  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at    TIMESTAMPTZ
);

COMMENT ON TABLE public.notifications IS 'In-app notifications — users can read, mark read, and delete their own.';


-- ── 1.14  SUPPORT_TICKETS ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,
  booking_id  UUID        REFERENCES public.bookings(id)           ON DELETE CASCADE,
  subject     TEXT        NOT NULL,
  description TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'OPEN' CHECK (
    status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')
  ),
  priority    TEXT        NOT NULL DEFAULT 'MEDIUM' CHECK (
    priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')
  ),
  assigned_to UUID        REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.support_tickets IS 'Customer support tickets — optionally linked to a booking.';


-- ── 1.15  REFRESH_TOKENS ──────────────────────────────────────────────────────
--  Stores hashed refresh tokens for custom JWT rotation.
--  service_role only — no RLS needed, no authenticated access.

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.refresh_tokens IS 'Hashed refresh tokens for JWT rotation — service_role access only.';



-- ███████████████████████████████████████████████████████████████████████████████
-- PART 2 — REFERENCE DATA SEED
-- ███████████████████████████████████████████████████████████████████████████████

INSERT INTO public.roles (name, description) VALUES
  ('CUSTOMER',    'Standard customer with booking access'),
  ('SALES',       'Sales agent — can view and manage bookings'),
  ('SUPPORT',     'Support agent — can handle tickets and view bookings'),
  ('ADMIN',       'Platform administrator'),
  ('SUPER_ADMIN', 'Full system access')
ON CONFLICT (name) DO NOTHING;


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 3 — HELPER FUNCTIONS  (used by all RLS policies)
-- ███████████████████████████████████████████████████████████████████████████████


-- ── Maps auth.uid() → public.users.id ────────────────────────────────────────
--  SECURITY DEFINER: runs as the function owner (postgres), not the caller.
--  STABLE: result is constant within a single SQL statement — safe to inline-cache.

CREATE OR REPLACE FUNCTION public.get_current_user_id()
  RETURNS UUID
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT id
  FROM   public.users
  WHERE  auth_user_id = auth.uid()
  LIMIT  1;
$$;


-- ── Returns TRUE if current user has a single given role ─────────────────────

CREATE OR REPLACE FUNCTION public.user_has_role(p_role TEXT)
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.user_roles ur
    JOIN   public.roles      r  ON r.id = ur.role_id
    WHERE  ur.user_id = public.get_current_user_id()
    AND    r.name     = p_role
  );
$$;


-- ── Returns TRUE if current user has ANY of the listed roles ─────────────────

CREATE OR REPLACE FUNCTION public.user_has_any_role(p_roles TEXT[])
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.user_roles ur
    JOIN   public.roles      r  ON r.id = ur.role_id
    WHERE  ur.user_id = public.get_current_user_id()
    AND    r.name     = ANY(p_roles)
  );
$$;


GRANT EXECUTE ON FUNCTION public.get_current_user_id()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_role(TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_any_role(TEXT[]) TO authenticated;


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 4 — ROW LEVEL SECURITY  (RLS)
--
-- ARCHITECTURE:
--   service_role (Express backend) → BYPASSES RLS  ← intentional
--   authenticated (Supabase JWT)   → filtered by policies below
--   anon                           → zero access (Part 6)
--
-- POLICY NAMING: <table>_<operation>_<who>
-- ███████████████████████████████████████████████████████████████████████████████


-- ── public.users ──────────────────────────────────────────────────────────────

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "users_select_own"        ON public.users;
DROP POLICY IF EXISTS "users_select_staff"      ON public.users;
DROP POLICY IF EXISTS "users_insert_self"       ON public.users;
DROP POLICY IF EXISTS "users_update_own"        ON public.users;
DROP POLICY IF EXISTS "users_update_admin"      ON public.users;
DROP POLICY IF EXISTS "users_delete_superadmin" ON public.users;

-- Customer: read only their own row
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (auth_user_id = auth.uid());

-- Staff: read any user (admin panel / support lookups)
CREATE POLICY "users_select_staff"
  ON public.users FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

-- New user may register only their own record (auth_user_id must match JWT)
CREATE POLICY "users_insert_self"
  ON public.users FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

-- Customer: update own profile fields
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING     (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Admin: update any user (toggle is_active, assign duffel_customer_user_id)
CREATE POLICY "users_update_admin"
  ON public.users FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));

-- Only SUPER_ADMIN can hard-delete a user
CREATE POLICY "users_delete_superadmin"
  ON public.users FOR DELETE
  USING (public.user_has_role('SUPER_ADMIN'));


-- ── public.roles ──────────────────────────────────────────────────────────────

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "roles_select_authenticated" ON public.roles;
DROP POLICY IF EXISTS "roles_write_superadmin"     ON public.roles;

-- All logged-in users can read role names (needed for frontend role checks)
CREATE POLICY "roles_select_authenticated"
  ON public.roles FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only SUPER_ADMIN can create / update / delete roles
CREATE POLICY "roles_write_superadmin"
  ON public.roles FOR ALL
  USING     (public.user_has_role('SUPER_ADMIN'))
  WITH CHECK (public.user_has_role('SUPER_ADMIN'));


-- ── public.user_roles ─────────────────────────────────────────────────────────

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "user_roles_select_own"   ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select_admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_write_admin"  ON public.user_roles;

-- Users can see their own role assignments
CREATE POLICY "user_roles_select_own"
  ON public.user_roles FOR SELECT
  USING (user_id = public.get_current_user_id());

-- Admins can see all role assignments
CREATE POLICY "user_roles_select_admin"
  ON public.user_roles FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));

-- Only Admins can assign or revoke roles
CREATE POLICY "user_roles_write_admin"
  ON public.user_roles FOR ALL
  USING     (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']))
  WITH CHECK (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));


-- ── public.bookings ───────────────────────────────────────────────────────────

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "bookings_select_own"   ON public.bookings;
DROP POLICY IF EXISTS "bookings_select_staff" ON public.bookings;
DROP POLICY IF EXISTS "bookings_insert_own"   ON public.bookings;
DROP POLICY IF EXISTS "bookings_update_own"   ON public.bookings;
DROP POLICY IF EXISTS "bookings_update_staff" ON public.bookings;

CREATE POLICY "bookings_select_own"
  ON public.bookings FOR SELECT
  USING (user_id = public.get_current_user_id());

CREATE POLICY "bookings_select_staff"
  ON public.bookings FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

CREATE POLICY "bookings_insert_own"
  ON public.bookings FOR INSERT
  WITH CHECK (user_id = public.get_current_user_id());

CREATE POLICY "bookings_update_own"
  ON public.bookings FOR UPDATE
  USING     (user_id = public.get_current_user_id())
  WITH CHECK (user_id = public.get_current_user_id());

-- Staff can update any booking (status overrides, refund flows)
CREATE POLICY "bookings_update_staff"
  ON public.bookings FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));

-- NO DELETE policy — bookings are immutable; only status changes allowed


-- ── public.travelers ──────────────────────────────────────────────────────────

ALTER TABLE public.travelers ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "travelers_select_booking_owner" ON public.travelers;
DROP POLICY IF EXISTS "travelers_select_staff"         ON public.travelers;
DROP POLICY IF EXISTS "travelers_insert_booking_owner" ON public.travelers;
DROP POLICY IF EXISTS "travelers_update_booking_owner" ON public.travelers;

CREATE POLICY "travelers_select_booking_owner"
  ON public.travelers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = travelers.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

CREATE POLICY "travelers_select_staff"
  ON public.travelers FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

CREATE POLICY "travelers_insert_booking_owner"
  ON public.travelers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = travelers.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

CREATE POLICY "travelers_update_booking_owner"
  ON public.travelers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = travelers.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );


-- ── public.flight_booking ─────────────────────────────────────────────────────

ALTER TABLE public.flight_booking ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "flight_booking_select_owner" ON public.flight_booking;
DROP POLICY IF EXISTS "flight_booking_select_staff" ON public.flight_booking;
DROP POLICY IF EXISTS "flight_booking_insert_owner" ON public.flight_booking;
DROP POLICY IF EXISTS "flight_booking_update_staff" ON public.flight_booking;

CREATE POLICY "flight_booking_select_owner"
  ON public.flight_booking FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = flight_booking.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

CREATE POLICY "flight_booking_select_staff"
  ON public.flight_booking FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

CREATE POLICY "flight_booking_insert_owner"
  ON public.flight_booking FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = flight_booking.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

-- Only staff can update (set duffel_order_id, pnr after order creation)
CREATE POLICY "flight_booking_update_staff"
  ON public.flight_booking FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));


-- ── public.hotel_booking ──────────────────────────────────────────────────────

ALTER TABLE public.hotel_booking ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "hotel_booking_select_owner" ON public.hotel_booking;
DROP POLICY IF EXISTS "hotel_booking_select_staff" ON public.hotel_booking;
DROP POLICY IF EXISTS "hotel_booking_insert_owner" ON public.hotel_booking;
DROP POLICY IF EXISTS "hotel_booking_update_staff" ON public.hotel_booking;

CREATE POLICY "hotel_booking_select_owner"
  ON public.hotel_booking FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = hotel_booking.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

CREATE POLICY "hotel_booking_select_staff"
  ON public.hotel_booking FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

CREATE POLICY "hotel_booking_insert_owner"
  ON public.hotel_booking FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = hotel_booking.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

CREATE POLICY "hotel_booking_update_staff"
  ON public.hotel_booking FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));


-- ── public.car_booking ────────────────────────────────────────────────────────

ALTER TABLE public.car_booking ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "car_booking_select_owner" ON public.car_booking;
DROP POLICY IF EXISTS "car_booking_select_staff" ON public.car_booking;
DROP POLICY IF EXISTS "car_booking_insert_owner" ON public.car_booking;
DROP POLICY IF EXISTS "car_booking_update_staff" ON public.car_booking;

CREATE POLICY "car_booking_select_owner"
  ON public.car_booking FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = car_booking.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

CREATE POLICY "car_booking_select_staff"
  ON public.car_booking FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

CREATE POLICY "car_booking_insert_owner"
  ON public.car_booking FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = car_booking.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

CREATE POLICY "car_booking_update_staff"
  ON public.car_booking FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));


-- ── public.payments ───────────────────────────────────────────────────────────

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "payments_select_own"   ON public.payments;
DROP POLICY IF EXISTS "payments_select_staff" ON public.payments;
DROP POLICY IF EXISTS "payments_update_admin" ON public.payments;

CREATE POLICY "payments_select_own"
  ON public.payments FOR SELECT
  USING (user_id = public.get_current_user_id());

CREATE POLICY "payments_select_staff"
  ON public.payments FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));

CREATE POLICY "payments_update_admin"
  ON public.payments FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));

-- NO INSERT for authenticated — only service_role (backend) inserts payments


-- ── public.refunds ────────────────────────────────────────────────────────────

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "refunds_select_own"   ON public.refunds;
DROP POLICY IF EXISTS "refunds_select_staff" ON public.refunds;
DROP POLICY IF EXISTS "refunds_update_admin" ON public.refunds;

CREATE POLICY "refunds_select_own"
  ON public.refunds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = refunds.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

CREATE POLICY "refunds_select_staff"
  ON public.refunds FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));

CREATE POLICY "refunds_update_admin"
  ON public.refunds FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));


-- ── public.booking_logs ───────────────────────────────────────────────────────

ALTER TABLE public.booking_logs ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "booking_logs_select_owner" ON public.booking_logs;
DROP POLICY IF EXISTS "booking_logs_select_staff" ON public.booking_logs;

CREATE POLICY "booking_logs_select_owner"
  ON public.booking_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = booking_logs.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

CREATE POLICY "booking_logs_select_staff"
  ON public.booking_logs FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

-- NO INSERT / UPDATE / DELETE for authenticated — service_role only


-- ── public.activity_logs ──────────────────────────────────────────────────────

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "activity_logs_select_own"   ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_admin" ON public.activity_logs;

CREATE POLICY "activity_logs_select_own"
  ON public.activity_logs FOR SELECT
  USING (user_id = public.get_current_user_id());

CREATE POLICY "activity_logs_select_admin"
  ON public.activity_logs FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));

-- NO INSERT for authenticated — service_role only


-- ── public.notifications ──────────────────────────────────────────────────────

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "notifications_select_own"   ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_admin" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own"   ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_own"   ON public.notifications;

CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  USING (user_id = public.get_current_user_id());

CREATE POLICY "notifications_select_admin"
  ON public.notifications FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));

CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  USING     (user_id = public.get_current_user_id())
  WITH CHECK (user_id = public.get_current_user_id());

CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE
  USING (user_id = public.get_current_user_id());

-- NO INSERT for authenticated — service_role only


-- ── public.support_tickets ────────────────────────────────────────────────────

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "tickets_select_own"   ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_select_staff" ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_insert_own"   ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_update_own"   ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_update_staff" ON public.support_tickets;

CREATE POLICY "tickets_select_own"
  ON public.support_tickets FOR SELECT
  USING (user_id = public.get_current_user_id());

CREATE POLICY "tickets_select_staff"
  ON public.support_tickets FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

CREATE POLICY "tickets_insert_own"
  ON public.support_tickets FOR INSERT
  WITH CHECK (user_id = public.get_current_user_id());

-- Customer can update their own ticket description (before it is actioned)
CREATE POLICY "tickets_update_own"
  ON public.support_tickets FOR UPDATE
  USING     (user_id = public.get_current_user_id())
  WITH CHECK (user_id = public.get_current_user_id());

-- Staff can update any ticket (status, priority, assignment, resolved_at)
CREATE POLICY "tickets_update_staff"
  ON public.support_tickets FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 5 — COLUMN LEVEL SECURITY  (CLS)
--
-- Strategy: REVOKE ALL from authenticated, then GRANT only safe columns back.
-- Sensitive columns (Stripe/Duffel keys, IPs, internal IDs) are never granted.
-- service_role always retains full access regardless of column grants.
-- ███████████████████████████████████████████████████████████████████████████████


-- ── public.users ──────────────────────────────────────────────────────────────

REVOKE ALL ON public.users FROM authenticated;

GRANT SELECT (
  id, auth_user_id, email, first_name, last_name, phone,
  is_active, duffel_customer_user_id, created_at, updated_at
) ON public.users TO authenticated;

-- PII travel doc columns — only reachable via own-row RLS policy
GRANT SELECT (date_of_birth, nationality, passport_number)
  ON public.users TO authenticated;

GRANT INSERT ON public.users TO authenticated;

GRANT UPDATE (
  first_name, last_name, phone,
  date_of_birth, nationality, passport_number
) ON public.users TO authenticated;
-- NOT updatable by authenticated: auth_user_id, is_active, duffel_customer_user_id


-- ── public.roles ──────────────────────────────────────────────────────────────

REVOKE ALL ON public.roles FROM authenticated;
GRANT SELECT (id, name, description, created_at) ON public.roles TO authenticated;


-- ── public.user_roles ─────────────────────────────────────────────────────────

REVOKE ALL ON public.user_roles FROM authenticated;
GRANT SELECT (id, user_id, role_id, assigned_at) ON public.user_roles TO authenticated;
-- assigned_by hidden (internal admin tracking)


-- ── public.bookings ───────────────────────────────────────────────────────────

REVOKE ALL ON public.bookings FROM authenticated;
GRANT SELECT (
  id, user_id, booking_type, status, total_amount, currency,
  booking_ref, notes, cancelled_at, cancellation_reason,
  created_at, updated_at
) ON public.bookings TO authenticated;
GRANT INSERT ON public.bookings TO authenticated;
GRANT UPDATE (
  status, notes, cancelled_at, cancellation_reason, updated_at
) ON public.bookings TO authenticated;


-- ── public.travelers ──────────────────────────────────────────────────────────

REVOKE ALL ON public.travelers FROM authenticated;
GRANT SELECT (
  id, booking_id, first_name, last_name, date_of_birth,
  nationality, gender, travel_type, email, phone, created_at
) ON public.travelers TO authenticated;
-- Passport columns — RLS restricts these to own-booking rows only
GRANT SELECT (passport_number, passport_expiry) ON public.travelers TO authenticated;
GRANT INSERT ON public.travelers TO authenticated;
GRANT UPDATE (
  first_name, last_name, date_of_birth, nationality,
  passport_number, passport_expiry, gender, email, phone
) ON public.travelers TO authenticated;


-- ── public.flight_booking ─────────────────────────────────────────────────────

REVOKE ALL ON public.flight_booking FROM authenticated;
GRANT SELECT (
  id, booking_id, duffel_offer_id, duffel_order_id,
  pnr, origin, destination, departure_time, return_date,
  trip_type, cabin_class, carrier, offer_date, provider, created_at
) ON public.flight_booking TO authenticated;
-- NOT granted: amadeus_order_id, provider_order_id (internal)
GRANT INSERT ON public.flight_booking TO authenticated;


-- ── public.hotel_booking ──────────────────────────────────────────────────────

REVOKE ALL ON public.hotel_booking FROM authenticated;
GRANT SELECT (
  id, booking_id, hotel_id, hotel_name,
  check_in_date, check_out_date, room_type, num_rooms, num_guests,
  duffel_offer_id, duffel_quote_id, duffel_order_id,
  provider, created_at
) ON public.hotel_booking TO authenticated;
-- NOT granted: offer_data (raw Duffel pricing), amadeus_order_id, provider_order_id
GRANT INSERT ON public.hotel_booking TO authenticated;


-- ── public.car_booking ────────────────────────────────────────────────────────

REVOKE ALL ON public.car_booking FROM authenticated;
GRANT SELECT (
  id, booking_id, pickup_location, dropoff_location,
  pickup_date, dropoff_date, car_type,
  duffel_offer_id, duffel_quote_id, duffel_order_id,
  provider, created_at
) ON public.car_booking TO authenticated;
-- NOT granted: offer_data (raw Duffel pricing)
GRANT INSERT ON public.car_booking TO authenticated;


-- ── public.payments  (!!! most sensitive table) ───────────────────────────────

REVOKE ALL ON public.payments FROM authenticated;
GRANT SELECT (
  id, booking_id, user_id, amount, currency,
  status, payment_method, payment_provider, paid_at,
  created_at, updated_at
) ON public.payments TO authenticated;
-- NEVER granted: stripe_session_id, stripe_payment_intent_id, stripe_charge_id,
--               duffel_payment_intent_id, duffel_client_key, meta_data


-- ── public.refunds ────────────────────────────────────────────────────────────

REVOKE ALL ON public.refunds FROM authenticated;
GRANT SELECT (
  id, booking_id, payment_id, amount, currency,
  reason, status, payment_provider,
  requested_by, processed_at, created_at
) ON public.refunds TO authenticated;
-- NOT granted: stripe_refund_id, duffel_refund_id (internal gateway IDs)


-- ── public.booking_logs ───────────────────────────────────────────────────────

REVOKE ALL ON public.booking_logs FROM authenticated;
GRANT SELECT (
  id, booking_id, action, old_status, new_status, message, created_at
) ON public.booking_logs TO authenticated;
-- NOT granted: meta_data (raw payloads), performed_by (admin user IDs)


-- ── public.activity_logs ──────────────────────────────────────────────────────

REVOKE ALL ON public.activity_logs FROM authenticated;
GRANT SELECT (
  id, user_id, action, entity_type, entity_id, created_at
) ON public.activity_logs TO authenticated;
-- NOT granted: id_address (IP), user_agent, meta_data


-- ── public.notifications ──────────────────────────────────────────────────────

REVOKE ALL ON public.notifications FROM authenticated;
GRANT SELECT (
  id, user_id, type, title, message,
  is_read, meta_data, created_at, read_at
) ON public.notifications TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.notifications TO authenticated;
GRANT DELETE                    ON public.notifications TO authenticated;


-- ── public.support_tickets ────────────────────────────────────────────────────

REVOKE ALL ON public.support_tickets FROM authenticated;
GRANT SELECT (
  id, user_id, booking_id, subject, description, status,
  priority, assigned_to, resolved_at, created_at, updated_at
) ON public.support_tickets TO authenticated;
GRANT INSERT (
  user_id, booking_id, subject, description, priority
) ON public.support_tickets TO authenticated;
GRANT UPDATE (
  description, status, updated_at
) ON public.support_tickets TO authenticated;


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 6 — LOCK DOWN anon ROLE
-- anon gets zero access to every application table.
-- All API calls go through the Express backend (service_role key).
-- ███████████████████████████████████████████████████████████████████████████████

-- refresh_tokens: no access for anon or authenticated — service_role only
REVOKE ALL ON public.refresh_tokens FROM anon;
REVOKE ALL ON public.refresh_tokens FROM authenticated;
GRANT  ALL ON public.refresh_tokens TO service_role;

REVOKE ALL ON public.users           FROM anon;
REVOKE ALL ON public.roles           FROM anon;
REVOKE ALL ON public.user_roles      FROM anon;
REVOKE ALL ON public.bookings        FROM anon;
REVOKE ALL ON public.travelers       FROM anon;
REVOKE ALL ON public.flight_booking  FROM anon;
REVOKE ALL ON public.hotel_booking   FROM anon;
REVOKE ALL ON public.car_booking     FROM anon;
REVOKE ALL ON public.payments        FROM anon;
REVOKE ALL ON public.refunds         FROM anon;
REVOKE ALL ON public.booking_logs    FROM anon;
REVOKE ALL ON public.activity_logs   FROM anon;
REVOKE ALL ON public.notifications   FROM anon;
REVOKE ALL ON public.support_tickets FROM anon;


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 7 — INDEXES
-- ███████████████████████████████████████████████████████████████████████████████


-- ── Core booking lookups ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_user_id        ON public.bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status         ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_type   ON public.bookings(booking_type);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_ref    ON public.bookings(booking_ref);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at     ON public.bookings(created_at);

-- ── Payment / refund lookups ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_booking        ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_user           ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider       ON public.payments(payment_provider);
CREATE INDEX IF NOT EXISTS idx_payments_duffel_intent  ON public.payments(duffel_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_refunds_booking         ON public.refunds(booking_id);

-- ── Duffel order ID lookups (webhook correlation) ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_flight_booking_duffel_order ON public.flight_booking(duffel_order_id);
CREATE INDEX IF NOT EXISTS idx_hotel_booking_duffel_order  ON public.hotel_booking(duffel_order_id);
CREATE INDEX IF NOT EXISTS idx_car_booking_duffel_order    ON public.car_booking(duffel_order_id);

-- ── Traveler lookups ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_travelers_booking       ON public.travelers(booking_id);

-- ── Log lookups ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_booking_logs_booking    ON public.booking_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_logs_action     ON public.booking_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user      ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity    ON public.activity_logs(entity_type, entity_id);

-- ── Notification lookups ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user      ON public.notifications(user_id);
-- Partial index — only unread rows (frequently queried, small subset)
CREATE INDEX IF NOT EXISTS idx_notifications_unread    ON public.notifications(user_id, is_read)
  WHERE is_read = false;

-- ── Support ticket lookups ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tickets_user            ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_booking         ON public.support_tickets(booking_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status          ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned        ON public.support_tickets(assigned_to);

-- ── User lookups ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_is_active         ON public.users(is_active);
-- Partial index — only users synced with Duffel
CREATE INDEX IF NOT EXISTS idx_users_duffel_id         ON public.users(duffel_customer_user_id)
  WHERE duffel_customer_user_id IS NOT NULL;


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 8 — TRIGGERS / UTILITY FUNCTIONS
-- ███████████████████████████████████████████████████████████████████████████████


-- ── Auto-update updated_at on every UPDATE ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
  RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to every table that has an updated_at column

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 9 — USEFUL JOIN VIEWS
--
-- These views are read-only conveniences for the Express backend (service_role).
-- They are NOT exposed to the authenticated role — access goes through the API.
-- ███████████████████████████████████████████████████████████████████████████████


-- ── v_booking_summary ─────────────────────────────────────────────────────────
--  One row per booking, joined with user name and payment status.
--  Useful for admin dashboards and listing endpoints.

CREATE OR REPLACE VIEW public.v_booking_summary AS
SELECT
  b.id                  AS booking_id,
  b.booking_ref,
  b.booking_type,
  b.status              AS booking_status,
  b.total_amount,
  b.currency,
  b.created_at          AS booked_at,
  -- User info
  u.id                  AS user_id,
  u.email               AS user_email,
  u.first_name          || ' ' || u.last_name AS user_full_name,
  -- Payment info
  p.status              AS payment_status,
  p.payment_provider,
  p.paid_at
FROM      public.bookings b
JOIN      public.users    u ON u.id = b.user_id
LEFT JOIN public.payments p ON p.booking_id = b.id;

COMMENT ON VIEW public.v_booking_summary IS
  'Admin view: booking + user name + payment status. Service role only.';


-- ── v_flight_booking_detail ───────────────────────────────────────────────────
--  Full flight booking row joined with its master booking and traveler count.

CREATE OR REPLACE VIEW public.v_flight_booking_detail AS
SELECT
  fb.id                AS flight_booking_id,
  fb.booking_id,
  fb.duffel_order_id,
  fb.pnr,
  fb.origin,
  fb.destination,
  fb.departure_time,
  fb.return_date,
  fb.trip_type,
  fb.cabin_class,
  fb.carrier,
  fb.provider,
  -- Master booking fields
  b.booking_ref,
  b.status             AS booking_status,
  b.total_amount,
  b.currency,
  -- User
  u.email              AS user_email,
  u.first_name         || ' ' || u.last_name AS user_full_name,
  -- Traveler head count
  (SELECT COUNT(*) FROM public.travelers t WHERE t.booking_id = b.id) AS traveler_count
FROM      public.flight_booking fb
JOIN      public.bookings b ON b.id = fb.booking_id
JOIN      public.users    u ON u.id = b.user_id;

COMMENT ON VIEW public.v_flight_booking_detail IS
  'Admin view: flight detail + booking + user + traveler count. Service role only.';


-- ── v_payment_detail ──────────────────────────────────────────────────────────
--  Payment joined with its booking and any associated refund.

CREATE OR REPLACE VIEW public.v_payment_detail AS
SELECT
  p.id                         AS payment_id,
  p.booking_id,
  p.payment_provider,
  p.amount,
  p.currency,
  p.status                     AS payment_status,
  p.payment_method,
  p.paid_at,
  -- Booking context
  b.booking_ref,
  b.booking_type,
  b.status                     AS booking_status,
  -- User context
  u.email                      AS user_email,
  -- Refund (if any)
  r.id                         AS refund_id,
  r.amount                     AS refund_amount,
  r.status                     AS refund_status,
  r.processed_at               AS refund_processed_at
FROM      public.payments p
JOIN      public.bookings b ON b.id = p.booking_id
JOIN      public.users    u ON u.id = p.user_id
LEFT JOIN public.refunds  r ON r.payment_id = p.id;

COMMENT ON VIEW public.v_payment_detail IS
  'Admin view: payment + booking + user + refund. Service role only.';


-- ── v_user_roles_flat ─────────────────────────────────────────────────────────
--  One row per user, with their roles as an aggregated array.

CREATE OR REPLACE VIEW public.v_user_roles_flat AS
SELECT
  u.id,
  u.email,
  u.first_name || ' ' || u.last_name AS full_name,
  u.is_active,
  ARRAY_AGG(r.name ORDER BY r.name)  AS roles
FROM      public.users      u
LEFT JOIN public.user_roles ur ON ur.user_id = u.id
LEFT JOIN public.roles       r ON r.id = ur.role_id
GROUP BY  u.id, u.email, u.first_name, u.last_name, u.is_active;

COMMENT ON VIEW public.v_user_roles_flat IS
  'Admin view: one user row with roles array. Service role only.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECURITY MODEL SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  ROLE          RLS ENFORCEMENT       COLUMN ACCESS
--  ────────────  ───────────────────   ──────────────────────────────────────
--  anon          N/A (zero access)     Revoked entirely
--  authenticated Own rows only         Safe columns only (no keys / IPs)
--  ADMIN         All rows              Same column restrictions as authenticated
--  SUPER_ADMIN   All rows + delete     Same column restrictions
--  SUPPORT       Read all bookings     Same column restrictions
--  SALES         Read all bookings     Same column restrictions
--  service_role  BYPASSES RLS          Full column access (backend only)
--
--  TABLE              CUSTOMER CAN READ                    CANNOT READ
--  ─────────────────  ─────────────────────────────────    ────────────────────────────────
--  users              Own profile (all fields)             Other users' rows
--  bookings           Own bookings                         Other users' bookings
--  travelers          Own booking travelers                 Other bookings' travelers
--  flight_booking     Own: Duffel order ID, PNR, route     amadeus_order_id, provider_order_id
--  hotel_booking      Own: hotel info, check-in/out        offer_data JSONB, provider_order_id
--  car_booking        Own: pickup/dropoff, car type         offer_data JSONB
--  payments           Own: amount, status, provider        Stripe/Duffel gateway keys
--  refunds            Own: amount, status, reason          stripe_refund_id, duffel_refund_id
--  booking_logs       Own: action, status changes          meta_data, performed_by
--  activity_logs      Own: action, entity, timestamp       IP address, user_agent
--  notifications      Own: full CRUD                       Other users' notifications
--  support_tickets    Own: full CRUD                       Other users' tickets
--
-- ═══════════════════════════════════════════════════════════════════════════════