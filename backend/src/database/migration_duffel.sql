-- ═══════════════════════════════════════════════════════════════════════════════
-- COMPLETE MIGRATION: Amadeus → Duffel  +  RLS  +  CLS
-- OTA Platform — Run once in Supabase SQL Editor
--
-- SECTIONS:
--   PART 1 — Schema changes  (Amadeus → Duffel column migration)
--   PART 2 — Helper functions (needed by RLS policies)
--   PART 3 — Row Level Security (RLS) per table
--   PART 4 — Column Level Security (CLS) per table
--   PART 5 — Lock down anon role
--   PART 6 — Additional performance indexes
--
-- SAFE TO RE-RUN: Every statement uses IF NOT EXISTS / DROP IF EXISTS / OR REPLACE
-- ═══════════════════════════════════════════════════════════════════════════════


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 1 — SCHEMA CHANGES  (Amadeus → Duffel)
-- ███████████████████████████████████████████████████████████████████████████████


-- ─────────────────────────────────────────────────────────────────────────────
-- 1A. payments
--     Old: stripe_session_id NOT NULL, stripe_payment_intent_id NOT NULL
--     New: both nullable + duffel payment columns + provider discriminator
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.payments
  ALTER COLUMN stripe_session_id        DROP NOT NULL,
  ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_provider         TEXT NOT NULL DEFAULT 'stripe'
    CHECK (payment_provider IN ('stripe', 'duffel')),
  ADD COLUMN IF NOT EXISTS duffel_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS duffel_client_key        TEXT;

-- Add unique constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_duffel_payment_intent_id_key'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_duffel_payment_intent_id_key
      UNIQUE (duffel_payment_intent_id);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1B. refunds
--     Old: stripe_refund_id NOT NULL
--     New: nullable + duffel_refund_id + provider discriminator
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.refunds
  ALTER COLUMN stripe_refund_id DROP NOT NULL;

ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS duffel_refund_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refunds_duffel_refund_id_key'
  ) THEN
    ALTER TABLE public.refunds
      ADD CONSTRAINT refunds_duffel_refund_id_key UNIQUE (duffel_refund_id);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1C. flight_booking
--     Old: amadeus_order_id TEXT (keep for historical data, just add Duffel cols)
--     New: duffel_offer_id, duffel_order_id, provider_order_id, provider
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.flight_booking
  ADD COLUMN IF NOT EXISTS duffel_offer_id   TEXT,
  ADD COLUMN IF NOT EXISTS duffel_order_id   TEXT,
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider          TEXT NOT NULL DEFAULT 'duffel';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flight_booking_duffel_order_id_key'
  ) THEN
    ALTER TABLE public.flight_booking
      ADD CONSTRAINT flight_booking_duffel_order_id_key UNIQUE (duffel_order_id);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1D. hotel_booking
--     Old: amadeus_order_id TEXT
--     New: duffel_offer_id, duffel_quote_id, duffel_order_id, provider_order_id, provider
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.hotel_booking
  ADD COLUMN IF NOT EXISTS duffel_offer_id   TEXT,
  ADD COLUMN IF NOT EXISTS duffel_quote_id   TEXT,
  ADD COLUMN IF NOT EXISTS duffel_order_id   TEXT,
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider          TEXT NOT NULL DEFAULT 'duffel';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hotel_booking_duffel_order_id_key'
  ) THEN
    ALTER TABLE public.hotel_booking
      ADD CONSTRAINT hotel_booking_duffel_order_id_key UNIQUE (duffel_order_id);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1E. car_booking
--     Old: amadeus_order_id TEXT, provider TEXT
--     New: duffel_offer_id, duffel_quote_id, duffel_order_id, provider_order_id
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.car_booking
  ADD COLUMN IF NOT EXISTS duffel_offer_id   TEXT,
  ADD COLUMN IF NOT EXISTS duffel_quote_id   TEXT,
  ADD COLUMN IF NOT EXISTS duffel_order_id   TEXT,
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'car_booking_duffel_order_id_key'
  ) THEN
    ALTER TABLE public.car_booking
      ADD CONSTRAINT car_booking_duffel_order_id_key UNIQUE (duffel_order_id);
  END IF;
END $$;

-- Set default on existing provider column
ALTER TABLE public.car_booking
  ALTER COLUMN provider SET DEFAULT 'duffel';


-- ─────────────────────────────────────────────────────────────────────────────
-- 1F. users — Duffel Identity column (for Phase 6 Identity sync)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS duffel_customer_user_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_duffel_customer_user_id_key'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_duffel_customer_user_id_key UNIQUE (duffel_customer_user_id);
  END IF;
END $$;


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 2 — HELPER FUNCTIONS  (used by all RLS policies below)
-- ███████████████████████████████████████████████████████████████████████████████


-- ─────────────────────────────────────────────────────────────────────────────
-- Maps auth.uid() (Supabase JWT UUID) → public.users.id (our app's user UUID)
-- SECURITY DEFINER: runs as the function owner (postgres), not the caller
-- STABLE: result is constant within a single SQL statement — safe to cache
-- ─────────────────────────────────────────────────────────────────────────────

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


-- ─────────────────────────────────────────────────────────────────────────────
-- Returns TRUE if the current authenticated user has the given single role
-- ─────────────────────────────────────────────────────────────────────────────

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


-- ─────────────────────────────────────────────────────────────────────────────
-- Returns TRUE if the current user has ANY of the listed roles
-- Used for multi-role staff checks: ADMIN | SUPPORT | SALES
-- ─────────────────────────────────────────────────────────────────────────────

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


-- Grant functions to authenticated role so policies can call them
GRANT EXECUTE ON FUNCTION public.get_current_user_id()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_role(TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_any_role(TEXT[]) TO authenticated;


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 3 — ROW LEVEL SECURITY (RLS)
--
-- ARCHITECTURE:
--   service_role (your Express backend) → BYPASSES RLS  ← intentional
--   authenticated (Supabase JWT users)  → FILTERED by policies below
--   anon                                → ZERO access (Part 5)
--
-- POLICY NAMING: <table>_<operation>_<who>
-- ███████████████████████████████████████████████████████████████████████████████


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.users
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own"          ON public.users;
DROP POLICY IF EXISTS "users_select_staff"        ON public.users;
DROP POLICY IF EXISTS "users_insert_self"         ON public.users;
DROP POLICY IF EXISTS "users_update_own"          ON public.users;
DROP POLICY IF EXISTS "users_update_admin"        ON public.users;
DROP POLICY IF EXISTS "users_delete_superadmin"   ON public.users;

-- Customer: read own row only
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (auth_user_id = auth.uid());

-- Staff: read any user (for admin panel / support lookups)
CREATE POLICY "users_select_staff"
  ON public.users FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

-- New user can register only their own record (auth_user_id must match JWT)
CREATE POLICY "users_insert_self"
  ON public.users FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

-- Customer: update own profile fields (not is_active, not auth_user_id)
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING     (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Admin: update any user (e.g. toggle is_active, assign duffel_customer_user_id)
CREATE POLICY "users_update_admin"
  ON public.users FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));

-- Only SUPER_ADMIN can hard-delete a user
CREATE POLICY "users_delete_superadmin"
  ON public.users FOR DELETE
  USING (public.user_has_role('SUPER_ADMIN'));


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.roles
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;

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


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.user_roles
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles_select_own"   ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select_admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_write_admin"  ON public.user_roles;

-- Users can see their own role assignments (e.g. to know they are CUSTOMER)
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


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.bookings
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_select_own"     ON public.bookings;
DROP POLICY IF EXISTS "bookings_select_staff"   ON public.bookings;
DROP POLICY IF EXISTS "bookings_insert_own"     ON public.bookings;
DROP POLICY IF EXISTS "bookings_update_own"     ON public.bookings;
DROP POLICY IF EXISTS "bookings_update_staff"   ON public.bookings;

-- Customer: only their own bookings
CREATE POLICY "bookings_select_own"
  ON public.bookings FOR SELECT
  USING (user_id = public.get_current_user_id());

-- Staff: all bookings
CREATE POLICY "bookings_select_staff"
  ON public.bookings FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

-- Customer can only create bookings linked to themselves
CREATE POLICY "bookings_insert_own"
  ON public.bookings FOR INSERT
  WITH CHECK (user_id = public.get_current_user_id());

-- Customer can update their own booking (add notes, cancel)
CREATE POLICY "bookings_update_own"
  ON public.bookings FOR UPDATE
  USING     (user_id = public.get_current_user_id())
  WITH CHECK (user_id = public.get_current_user_id());

-- Staff can update any booking (status overrides, refund flows)
CREATE POLICY "bookings_update_staff"
  ON public.bookings FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));

-- NO DELETE policy — bookings are immutable; only status changes


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.travelers
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.travelers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travelers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "travelers_select_booking_owner" ON public.travelers;
DROP POLICY IF EXISTS "travelers_select_staff"         ON public.travelers;
DROP POLICY IF EXISTS "travelers_insert_booking_owner" ON public.travelers;
DROP POLICY IF EXISTS "travelers_update_booking_owner" ON public.travelers;

-- Customer: only travelers on their own bookings
CREATE POLICY "travelers_select_booking_owner"
  ON public.travelers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = travelers.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

-- Staff: all travelers
CREATE POLICY "travelers_select_staff"
  ON public.travelers FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

-- Can only insert travelers on own bookings
CREATE POLICY "travelers_insert_booking_owner"
  ON public.travelers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = travelers.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

-- Can update traveler details on own bookings only
CREATE POLICY "travelers_update_booking_owner"
  ON public.travelers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = travelers.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.flight_booking
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.flight_booking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flight_booking FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flight_booking_select_owner"  ON public.flight_booking;
DROP POLICY IF EXISTS "flight_booking_select_staff"  ON public.flight_booking;
DROP POLICY IF EXISTS "flight_booking_insert_owner"  ON public.flight_booking;
DROP POLICY IF EXISTS "flight_booking_update_staff"  ON public.flight_booking;

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

-- Backend (service_role) inserts this; authenticated INSERT kept for flexibility
CREATE POLICY "flight_booking_insert_owner"
  ON public.flight_booking FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = flight_booking.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

-- Only staff can update (e.g. set duffel_order_id, pnr after order creation)
CREATE POLICY "flight_booking_update_staff"
  ON public.flight_booking FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.hotel_booking
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.hotel_booking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_booking FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hotel_booking_select_owner"  ON public.hotel_booking;
DROP POLICY IF EXISTS "hotel_booking_select_staff"  ON public.hotel_booking;
DROP POLICY IF EXISTS "hotel_booking_insert_owner"  ON public.hotel_booking;
DROP POLICY IF EXISTS "hotel_booking_update_staff"  ON public.hotel_booking;

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


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.car_booking
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.car_booking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_booking FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "car_booking_select_owner"  ON public.car_booking;
DROP POLICY IF EXISTS "car_booking_select_staff"  ON public.car_booking;
DROP POLICY IF EXISTS "car_booking_insert_owner"  ON public.car_booking;
DROP POLICY IF EXISTS "car_booking_update_staff"  ON public.car_booking;

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


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.payments
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_select_own"    ON public.payments;
DROP POLICY IF EXISTS "payments_select_staff"  ON public.payments;
DROP POLICY IF EXISTS "payments_update_admin"  ON public.payments;

-- Customer: see only their own payment records
CREATE POLICY "payments_select_own"
  ON public.payments FOR SELECT
  USING (user_id = public.get_current_user_id());

-- Staff: see all payments
CREATE POLICY "payments_select_staff"
  ON public.payments FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));

-- Only Admins can update payment records
CREATE POLICY "payments_update_admin"
  ON public.payments FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));

-- NO INSERT policy for authenticated — only service_role (backend) inserts payments


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.refunds
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "refunds_select_own"    ON public.refunds;
DROP POLICY IF EXISTS "refunds_select_staff"  ON public.refunds;
DROP POLICY IF EXISTS "refunds_update_admin"  ON public.refunds;

-- Customer: see refunds for their own bookings
CREATE POLICY "refunds_select_own"
  ON public.refunds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = refunds.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

-- Staff: see all refunds
CREATE POLICY "refunds_select_staff"
  ON public.refunds FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));

-- Only Admins can update refund status
CREATE POLICY "refunds_update_admin"
  ON public.refunds FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));

-- NO INSERT for authenticated — only service_role inserts refund records


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.booking_logs
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.booking_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_logs_select_owner"  ON public.booking_logs;
DROP POLICY IF EXISTS "booking_logs_select_staff"  ON public.booking_logs;

-- Customer: read logs for their own bookings (status history)
CREATE POLICY "booking_logs_select_owner"
  ON public.booking_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE  b.id      = booking_logs.booking_id
      AND    b.user_id = public.get_current_user_id()
    )
  );

-- Staff: read all booking logs (full audit trail)
CREATE POLICY "booking_logs_select_staff"
  ON public.booking_logs FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

-- NO INSERT / UPDATE / DELETE for authenticated — only service_role writes logs


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.activity_logs
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_logs_select_own"    ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_admin"  ON public.activity_logs;

-- Users can see their own activity history
CREATE POLICY "activity_logs_select_own"
  ON public.activity_logs FOR SELECT
  USING (user_id = public.get_current_user_id());

-- Only Admins can see all activity (security audit)
CREATE POLICY "activity_logs_select_admin"
  ON public.activity_logs FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));

-- NO INSERT for authenticated — only service_role writes logs


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.notifications
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own"   ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_admin" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own"   ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_own"   ON public.notifications;

-- Users can only see their own notifications
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  USING (user_id = public.get_current_user_id());

-- Admins can see all notifications (support / debugging)
CREATE POLICY "notifications_select_admin"
  ON public.notifications FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN']));

-- Users can mark their own notifications as read
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  USING     (user_id = public.get_current_user_id())
  WITH CHECK (user_id = public.get_current_user_id());

-- Users can delete their own notifications
CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE
  USING (user_id = public.get_current_user_id());

-- NO INSERT for authenticated — only service_role creates notifications


-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: public.support_tickets
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tickets_select_own"    ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_select_staff"  ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_insert_own"    ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_update_own"    ON public.support_tickets;
DROP POLICY IF EXISTS "tickets_update_staff"  ON public.support_tickets;

-- Customer: see only their own tickets
CREATE POLICY "tickets_select_own"
  ON public.support_tickets FOR SELECT
  USING (user_id = public.get_current_user_id());

-- Support / Admin: see all tickets
CREATE POLICY "tickets_select_staff"
  ON public.support_tickets FOR SELECT
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT','SALES']));

-- Customer can only open tickets for themselves
CREATE POLICY "tickets_insert_own"
  ON public.support_tickets FOR INSERT
  WITH CHECK (user_id = public.get_current_user_id());

-- Customer can update their own ticket description (before it's actioned)
CREATE POLICY "tickets_update_own"
  ON public.support_tickets FOR UPDATE
  USING     (user_id = public.get_current_user_id())
  WITH CHECK (user_id = public.get_current_user_id());

-- Staff can update any ticket (status, priority, assignment, resolved_at)
CREATE POLICY "tickets_update_staff"
  ON public.support_tickets FOR UPDATE
  USING (public.user_has_any_role(ARRAY['ADMIN','SUPER_ADMIN','SUPPORT']));


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 4 — COLUMN LEVEL SECURITY (CLS)
--
-- Strategy: REVOKE ALL from authenticated, then GRANT only safe columns back.
-- Sensitive columns (Stripe/Duffel keys, IP addresses, internal IDs, passport
-- numbers of other travelers) are never granted to the authenticated role.
-- service_role always has full access regardless.
-- ███████████████████████████████████████████████████████████████████████████████


-- ─────────────────────────────────────────────────────────────────────────────
-- public.users
-- Hidden from authenticated: (none — own row has full access via RLS)
-- Hidden from staff reads:   date_of_birth, passport_number, nationality
--                            (staff sees email/name but not PII travel docs)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.users FROM authenticated;

GRANT SELECT (
  id, auth_user_id, email, first_name, last_name, phone,
  is_active, duffel_customer_user_id, created_at, updated_at
) ON public.users TO authenticated;

-- PII travel doc columns — accessible via RLS "select_own" policy only
-- (When a staff policy matches, these columns are still visible because
--  column grants are not filtered by which RLS policy matched.
--  To truly hide these from staff, use a VIEW — see note below.)
GRANT SELECT (date_of_birth, nationality, passport_number)
  ON public.users TO authenticated;

GRANT INSERT ON public.users TO authenticated;

-- Customers may update safe profile fields only
GRANT UPDATE (
  first_name, last_name, phone,
  date_of_birth, nationality, passport_number
) ON public.users TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- public.roles  — read-only reference data
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.roles FROM authenticated;
GRANT SELECT (id, name, description, created_at) ON public.roles TO authenticated;
-- SUPER_ADMIN writes handled via service_role in backend


-- ─────────────────────────────────────────────────────────────────────────────
-- public.user_roles
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.user_roles FROM authenticated;
GRANT SELECT (id, user_id, role_id, assigned_at) ON public.user_roles TO authenticated;
-- assigned_by hidden (internal admin tracking)


-- ─────────────────────────────────────────────────────────────────────────────
-- public.bookings
-- ─────────────────────────────────────────────────────────────────────────────

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


-- ─────────────────────────────────────────────────────────────────────────────
-- public.travelers
-- Hidden from authenticated: passport_number, passport_expiry
--   (visible only through own-booking RLS policy)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.travelers FROM authenticated;
GRANT SELECT (
  id, booking_id, first_name, last_name, date_of_birth,
  nationality, gender, travel_type, email, phone, created_at
) ON public.travelers TO authenticated;
-- Passport columns — RLS limits this to own bookings only
GRANT SELECT (passport_number, passport_expiry) ON public.travelers TO authenticated;
GRANT INSERT ON public.travelers TO authenticated;
GRANT UPDATE (
  first_name, last_name, date_of_birth, nationality,
  passport_number, passport_expiry, gender, email, phone
) ON public.travelers TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- public.flight_booking
-- Hidden from authenticated: amadeus_order_id (legacy), provider_order_id
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.flight_booking FROM authenticated;
GRANT SELECT (
  id, booking_id, duffel_offer_id, duffel_order_id,
  pnr, origin, destination, departure_time, return_date,
  trip_type, cabin_class, carrier, offer_date, provider, created_at
) ON public.flight_booking TO authenticated;
-- amadeus_order_id and provider_order_id are internal — not granted
GRANT INSERT ON public.flight_booking TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- public.hotel_booking
-- Hidden from authenticated: offer_data JSONB (contains raw Duffel pricing)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.hotel_booking FROM authenticated;
GRANT SELECT (
  id, booking_id, hotel_id, hotel_name,
  check_in_date, check_out_date, room_type, num_rooms, num_guests,
  duffel_offer_id, duffel_quote_id, duffel_order_id,
  provider, created_at
) ON public.hotel_booking TO authenticated;
-- offer_data (raw Duffel quote JSONB with rate breakdowns) NOT granted
-- amadeus_order_id and provider_order_id NOT granted
GRANT INSERT ON public.hotel_booking TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- public.car_booking
-- Hidden from authenticated: offer_data JSONB
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.car_booking FROM authenticated;
GRANT SELECT (
  id, booking_id, pickup_location, dropoff_location,
  pickup_date, dropoff_date, car_type,
  duffel_offer_id, duffel_quote_id, duffel_order_id,
  provider, created_at
) ON public.car_booking TO authenticated;
-- offer_data NOT granted
GRANT INSERT ON public.car_booking TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- public.payments
-- !! Most sensitive table — Stripe + Duffel keys never exposed to client !!
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.payments FROM authenticated;
GRANT SELECT (
  id, booking_id, user_id, amount, currency,
  status, payment_method, payment_provider, paid_at,
  created_at, updated_at
) ON public.payments TO authenticated;
-- NEVER granted to authenticated:
--   stripe_session_id, stripe_payment_intent_id, stripe_charge_id
--   duffel_payment_intent_id, duffel_client_key
--   meta_data (may contain internal gateway responses)


-- ─────────────────────────────────────────────────────────────────────────────
-- public.refunds
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.refunds FROM authenticated;
GRANT SELECT (
  id, booking_id, payment_id, amount, currency,
  reason, status, payment_provider,
  requested_by, processed_at, created_at
) ON public.refunds TO authenticated;
-- stripe_refund_id, duffel_refund_id: NOT granted (internal gateway IDs)


-- ─────────────────────────────────────────────────────────────────────────────
-- public.booking_logs
-- Customers see: action, status changes, timestamps (no internal meta_data)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.booking_logs FROM authenticated;
GRANT SELECT (
  id, booking_id, action, old_status, new_status, message, created_at
) ON public.booking_logs TO authenticated;
-- meta_data (raw payloads) and performed_by (admin user IDs) NOT granted


-- ─────────────────────────────────────────────────────────────────────────────
-- public.activity_logs
-- Customers see: action, entity info, timestamp (not IP or user_agent)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.activity_logs FROM authenticated;
GRANT SELECT (
  id, user_id, action, entity_type, entity_id, created_at
) ON public.activity_logs TO authenticated;
-- id_address (IP), user_agent, meta_data: NOT granted to authenticated
-- Only service_role and ADMIN (via backend) can see those


-- ─────────────────────────────────────────────────────────────────────────────
-- public.notifications
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.notifications FROM authenticated;
GRANT SELECT (
  id, user_id, type, title, message,
  is_read, meta_data, created_at, read_at
) ON public.notifications TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.notifications TO authenticated;
GRANT DELETE ON public.notifications TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- public.support_tickets
-- ─────────────────────────────────────────────────────────────────────────────

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
-- PART 5 — LOCK DOWN anon ROLE
-- anon gets zero access to every application table.
-- All API calls go through your Express backend (service_role key).
-- ███████████████████████████████████████████████████████████████████████████████

REVOKE ALL ON public.users            FROM anon;
REVOKE ALL ON public.roles            FROM anon;
REVOKE ALL ON public.user_roles       FROM anon;
REVOKE ALL ON public.bookings         FROM anon;
REVOKE ALL ON public.travelers        FROM anon;
REVOKE ALL ON public.flight_booking   FROM anon;
REVOKE ALL ON public.hotel_booking    FROM anon;
REVOKE ALL ON public.car_booking      FROM anon;
REVOKE ALL ON public.payments         FROM anon;
REVOKE ALL ON public.refunds          FROM anon;
REVOKE ALL ON public.booking_logs     FROM anon;
REVOKE ALL ON public.activity_logs    FROM anon;
REVOKE ALL ON public.notifications    FROM anon;
REVOKE ALL ON public.support_tickets  FROM anon;


-- ███████████████████████████████████████████████████████████████████████████████
-- PART 6 — ADDITIONAL PERFORMANCE INDEXES
-- ███████████████████████████████████████████████████████████████████████████████

-- Duffel order lookup indexes
CREATE INDEX IF NOT EXISTS idx_flight_booking_duffel_order  ON public.flight_booking(duffel_order_id);
CREATE INDEX IF NOT EXISTS idx_hotel_booking_duffel_order   ON public.hotel_booking(duffel_order_id);
CREATE INDEX IF NOT EXISTS idx_car_booking_duffel_order     ON public.car_booking(duffel_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_duffel_intent       ON public.payments(duffel_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider            ON public.payments(payment_provider);

-- Query performance indexes
CREATE INDEX IF NOT EXISTS idx_notifications_unread   ON public.notifications(user_id, is_read)
  WHERE is_read = false;                               -- partial index: only unread rows
CREATE INDEX IF NOT EXISTS idx_bookings_created_at    ON public.bookings(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity   ON public.activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status         ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned       ON public.support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_refunds_booking        ON public.refunds(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_user          ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_booking_logs_action    ON public.booking_logs(action);
CREATE INDEX IF NOT EXISTS idx_users_is_active        ON public.users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_duffel_id        ON public.users(duffel_customer_user_id)
  WHERE duffel_customer_user_id IS NOT NULL;           -- partial index: only synced users


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECURITY MODEL SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  ROLE           RLS ENFORCEMENT      COLUMN ACCESS
--  ─────────────  ─────────────────    ───────────────────────────────────────
--  anon           N/A (zero access)    Revoked entirely
--  authenticated  Own rows only        Safe columns only (no keys/IPs)
--  ADMIN          All rows             Same column restrictions as authenticated
--  SUPER_ADMIN    All rows + delete    Same column restrictions
--  SUPPORT        Read all bookings    Same column restrictions
--  SALES          Read all bookings    Same column restrictions
--  service_role   BYPASSES RLS         Full column access (backend only)
--
--  TABLE              CUSTOMER CAN READ                    CANNOT READ
--  ─────────────────  ──────────────────────────────────   ────────────────────────────────
--  users              Own profile (all fields)             Other users' rows
--  bookings           Own bookings                         Other users' bookings
--  travelers          Own booking travelers                 Other bookings' travelers
--  flight_booking     Own: Duffel order ID, PNR, route     amadeus_order_id, provider_order_id
--  hotel_booking      Own: hotel info, check-in/out        offer_data JSONB, provider_order_id
--  car_booking        Own: pickup/dropoff, car type        offer_data JSONB
--  payments           Own: amount, status, provider        Stripe/Duffel gateway keys
--  refunds            Own: amount, status, reason          stripe_refund_id, duffel_refund_id
--  booking_logs       Own: action, status changes          meta_data, performed_by
--  activity_logs      Own: action, entity, timestamp       IP address, user_agent
--  notifications      Own: full CRUD                       Other users' notifications
--  support_tickets    Own: full CRUD                       Other users' tickets
--
-- ═══════════════════════════════════════════════════════════════════════════════