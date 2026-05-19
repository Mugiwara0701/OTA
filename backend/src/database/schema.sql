-- ══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- Enable the unique id generation

-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.users (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id        UUID UNIQUE NOT NULL,     -- Foreign Key to auth.users.id
  email               TEXT UNIQUE NOT NULL,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  phone               TEXT NOT NULL,
  date_of_birth       DATE NOT NULL,
  nationality         TEXT NOT NULL,
  passport_number     TEXT UNIQUE NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.roles(
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT UNIQUE NOT NULL,
  description         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═════════════════════════════════════════════════════════════════════════════

INSERT INTO public.roles (name, description) VALUES
  ('CUSTOMER', 'Standard customer with booking access'),
  ('SALES', 'Sales agent — can view and manage bookings'),
  ('SUPPORT', 'Support agent — can handle tickets and view bookings'),
  ('ADMIN', 'Platform administrator'),
  ('SUPER_ADMIN', 'Full system access') 
ON CONFLICT (name) DO NOTHING;

-- ── USER_ROLES (many-to-many) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_roles (
  id                  SERIAL PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id             UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by         UUID REFERENCES public.users(id),
  UNIQUE (user_id, role_id)
); 


-- ── BOOKINGS (master booking record) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bookings(
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  booking_type        TEXT NOT NULL CHECK (booking_type IN ('FLIGHT', 'HOTEL', 'CAR')),
  status              TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (
    status IN (
      'PENDING_PAYMENT',
      'PAYMENT_PROCESSING',
      'CONFIRMED',
      'CANCELLED',
      'REFUND_REQUESTED',
      'REFUND_PROCESSING',
      'REFUNDED',
      'FAILED'
    )
  ),
  total_amount        NUMERIC(12, 2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  booking_ref         TEXT UNIQUE NOT NULL,
  notes               TEXT,
  cancelled_at        TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TRAVELERS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.travelers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id          UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  date_of_birth       DATE NOT NULL,
  nationality         TEXT NOT NULL,
  passport_number     TEXT UNIQUE NOT NULL,
  passport_expiry     DATE NOT NULL,
  gender              TEXT NOT NULL CHECK(gender IN ('MALE', 'FEMALE', 'OTHER')),
  travel_type         TEXT NOT NULL CHECK(travel_type IN ('ADULT', 'CHILD', 'INFANT')),
  email               TEXT,
  phone               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── FLIGHT_BOOKINGS ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.flight_booking(
  id                  UUID PRIMARY kEY DEFAULT uuid_generate_v4(),
  booking_id          UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  amadeus_order_id    TEXT,
  pnr                 TEXT,
  origin              TEXT NOT NULL,
  destination         TEXT NOT NULL,
  departure_time      TIMESTAMPTZ NOT NULL,
  return_date         TIMESTAMPTZ,
  trip_type           TEXT NOT NULL CHECK(trip_type IN ('ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY')),
  cabin_class         TEXT NOT NULL CHECK(cabin_class IN ('ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST')),
  carrier             TEXT NOT NULL,
  offer_date          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);



-- ── HOTEL_BOOKINGS ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_booking(
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id          UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  amadeus_order_id    TEXT,
  hotel_id            TEXT NOT NULL,
  hotel_name          TEXT NOT NULL,
  check_in_date       DATE NOT NULL,
  check_out_date      DATE NOT NULL,
  room_type           TEXT,
  num_rooms           INTEGER NOT NULL DEFAULT 1,
  num_guests          INTEGER NOT NULL DEFAULT 1,
  offer_data          JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── CAR_BOOKINGS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.car_booking(
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id          UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  amadeus_order_id    TEXT,
  pickup_location     TEXT NOT NULL,
  dropoff_location    TEXT NOT NULL,
  pickup_date         TIMESTAMPTZ NOT NULL,
  dropoff_date        TIMESTAMPTZ NOT NULL,
  car_type            TEXT,
  provider            TEXT,
  offer_data          JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── PAYMENTS ──────────────────────────────────────────────────────────────


CREATE TABLE IF NOT EXISTS public.payments (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id                  UUID UNIQUE NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id                     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_session_id           TEXT UNIQUE NOT NULL,
  stripe_payment_intent_id    TEXT UNIQUE NOT NULL,
  stripe_charge_id            TEXT,
  amount                      NUMERIC(12,2) NOT NULL,
  currency                    TEXT NOT NULL DEFAULT 'USD',
  status                      TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN (
      'PENDING',
      'PROCESSING',
      'COMPLETED',
      'FAILED',
      'REFUNDED',
      'REFUND_PROCESSING'
    )
  ),
  payment_method              TEXT,
  paid_at                     TIMESTAMPTZ,
  meta_Data                   JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);



-- ── REFUNDS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.refunds (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id                  UUID UNIQUE NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  payment_id                  UUID UNIQUE NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  stripe_refund_id            TEXT UNIQUE NOT NULL,
  amount                      NUMERIC(12,2) NOT NULL,
  currency                    TEXT NOT NULL DEFAULT 'USD',
  reason                      TEXT,
  status                      TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (
    status IN (
      'REQUESTED',
      'PROCESSING',
      'COMPLETED',
      'FAILED'
    )
  ),
  requested_by                UUID REFERENCES public.users(id),
  processed_at                TIMESTAMPTZ,
  created_At                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);



-- ── BOOKING_LOGS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.booking_logs (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id                  UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  action                      TEXT NOT NULL,
  old_status                  TEXT,
  new_status                  TEXT,
  message                     TEXT,
  meta_data                   JSONB,
  performed_by                UUID REFERENCES public.users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── ACTIVITY_LOGS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action                      TEXT NOT NULL,
  entity_type                 TEXT,
  entity_id                   TEXT,
  id_address                  TEXT,
  user_agent                  TEXT,
  meta_data                   JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);



-- ── NOTIFICATION ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type                        TEXT NOT NULL,
  title                       TEXT NOT NULL,
  message                     TEXT NOT NULL,
  is_read                     BOOLEAN NOT NULL DEFAULT false,
  meta_data                   JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at                     TIMESTAMPTZ
);



-- ── SUPPORT_TICKETS ──────────────────────────────────────────────────────────────


CREATE TABLE IF NOT EXISTS public.support_tickets (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  booking_id                  UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  subject                     TEXT NOT NULL,
  description                 TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'OPEN' CHECK (
    status IN (
      'OPEN',
      'IN_PROGRESS',
      'RESOLVED',
      'CLOSED'
    )
  ),
  priority                    TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (
    priority IN (
      'LOW',
      'MEDIUM',
      'HIGH',
      'URGENT'
    )
  ),
  assigned_to                 UUID REFERENCES public.users(id),
  resolved_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── INDEXES (performance) ─────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON public.bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_type ON public.bookings(booking_type);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_ref ON public.bookings(booking_ref);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_logs_booking ON public.booking_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_booking ON public.support_tickets(booking_id);



-- ── UPDATED_AT AUTO TRIGGER FUNCTIONS ─────────────────────────────────────────────────────

-- Automatically update the updated_at timestamp on bookings when they are modified


CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';


CREATE OR REPLACE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


CREATE OR REPLACE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

