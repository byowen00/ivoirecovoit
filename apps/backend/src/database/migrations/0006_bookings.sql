-- 0006 : réservations
CREATE TABLE bookings (
  id                       uuid PRIMARY KEY,
  reference                varchar(10) NOT NULL UNIQUE CHECK (reference ~ '^IC-[A-HJ-NP-Z2-9]{6}$'),
  trip_id                  uuid NOT NULL REFERENCES trips(id),
  passenger_id             uuid NOT NULL REFERENCES users(id),
  pickup_stop_id           uuid NOT NULL,
  dropoff_stop_id          uuid NOT NULL,
  pickup_seq               smallint NOT NULL,
  dropoff_seq              smallint NOT NULL,
  seats                    smallint NOT NULL CHECK (seats BETWEEN 1 AND 8),
  status                   booking_status NOT NULL,
  payment_status           booking_payment_status NOT NULL DEFAULT 'UNPAID',
  payment_method           payment_method,
  unit_price_xof           bigint NOT NULL CHECK (unit_price_xof >= 0),
  subtotal_xof             bigint NOT NULL,
  service_fee_xof          bigint NOT NULL CHECK (service_fee_xof >= 0),
  discount_xof             bigint NOT NULL DEFAULT 0 CHECK (discount_xof >= 0),
  total_xof                bigint NOT NULL CHECK (total_xof >= 0),
  commission_xof           bigint NOT NULL CHECK (commission_xof >= 0),
  driver_net_xof           bigint NOT NULL CHECK (driver_net_xof >= 0),
  fee_rule_id              uuid NOT NULL REFERENCES fee_rules(id),
  promotion_id             uuid REFERENCES promotions(id),
  cancellation_policy_code varchar(20) NOT NULL REFERENCES cancellation_policies(code),
  hold_expires_at          timestamptz,
  acceptance_deadline      timestamptz,
  accepted_at              timestamptz,
  confirmed_at             timestamptz,
  cancelled_at             timestamptz,
  cancelled_by             uuid REFERENCES users(id),
  cancellation_reason      varchar(300),
  completed_at             timestamptz,
  is_demo                  boolean NOT NULL DEFAULT false,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  -- Les arrêts doivent appartenir au trajet réservé
  FOREIGN KEY (pickup_stop_id, trip_id)  REFERENCES trip_stops(id, trip_id),
  FOREIGN KEY (dropoff_stop_id, trip_id) REFERENCES trip_stops(id, trip_id),
  CHECK (dropoff_seq > pickup_seq),
  -- Cohérence des montants (entiers XOF)
  CHECK (subtotal_xof = unit_price_xof * seats),
  CHECK (total_xof = subtotal_xof + service_fee_xof - discount_xof),
  CHECK (commission_xof <= subtotal_xof),
  CHECK (driver_net_xof = subtotal_xof - commission_xof),
  CHECK (status NOT IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT') OR hold_expires_at IS NOT NULL)
);
-- Un passager n'a qu'une réservation active par trajet
CREATE UNIQUE INDEX bookings_one_active_per_trip ON bookings (trip_id, passenger_id)
  WHERE status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT','CONFIRMED');
CREATE INDEX bookings_trip_active_idx ON bookings (trip_id)
  WHERE status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT','CONFIRMED');
CREATE INDEX bookings_passenger_idx ON bookings (passenger_id, created_at DESC);
CREATE INDEX bookings_hold_expiry_idx ON bookings (hold_expires_at)
  WHERE status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT');
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- pickup_seq / dropoff_seq sont recopiés depuis les arrêts : impossible de les falsifier
CREATE OR REPLACE FUNCTION bookings_sync_stop_seq() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT seq INTO NEW.pickup_seq FROM trip_stops WHERE id = NEW.pickup_stop_id;
  SELECT seq INTO NEW.dropoff_seq FROM trip_stops WHERE id = NEW.dropoff_stop_id;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_stop_seq BEFORE INSERT OR UPDATE OF pickup_stop_id, dropoff_stop_id ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_sync_stop_seq();

CREATE TABLE booking_passengers (
  id          uuid PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  full_name   varchar(120) NOT NULL,
  phone_e164  varchar(16) CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  is_booker   boolean NOT NULL DEFAULT false,
  no_show     boolean
);
CREATE INDEX booking_passengers_booking_idx ON booking_passengers (booking_id);

CREATE TABLE booking_status_history (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  from_status booking_status,
  to_status   booking_status NOT NULL,
  actor_id    uuid REFERENCES users(id),
  reason      varchar(300),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_status_history_booking_idx ON booking_status_history (booking_id, created_at);
