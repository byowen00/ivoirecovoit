-- 0007 : paiements, événements prestataire, remboursements, commissions, versements, grand livre, rapprochement
CREATE TABLE payments (
  id                 uuid PRIMARY KEY,
  booking_id         uuid NOT NULL REFERENCES bookings(id),
  provider           varchar(30) NOT NULL,
  method             payment_method NOT NULL,
  amount_xof         bigint NOT NULL CHECK (amount_xof > 0),
  currency           char(3) NOT NULL DEFAULT 'XOF',
  status             payment_status NOT NULL DEFAULT 'CREATED',
  provider_reference varchar(100),
  payer_phone_masked varchar(20),
  idempotency_key    uuid NOT NULL UNIQUE,
  failure_code       varchar(50),
  failure_message    varchar(300),
  expires_at         timestamptz NOT NULL,
  succeeded_at       timestamptz,
  provider_fee_xof   bigint CHECK (provider_fee_xof >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_reference),
  CHECK (status <> 'SUCCEEDED' OR succeeded_at IS NOT NULL)
);
CREATE UNIQUE INDEX payments_one_success_per_booking ON payments (booking_id) WHERE status = 'SUCCEEDED';
CREATE UNIQUE INDEX payments_one_pending_per_booking ON payments (booking_id) WHERE status IN ('CREATED','PENDING');
CREATE INDEX payments_pending_idx ON payments (created_at) WHERE status IN ('CREATED','PENDING');
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_events (
  id                uuid PRIMARY KEY,
  payment_id        uuid REFERENCES payments(id),
  provider          varchar(30) NOT NULL,
  provider_event_id varchar(150) NOT NULL,
  source            varchar(10) NOT NULL CHECK (source IN ('WEBHOOK','POLL','MANUAL')),
  event_type        varchar(50) NOT NULL,
  reported_status   varchar(30),
  amount_xof        bigint,
  signature_valid   boolean NOT NULL,
  raw_payload       jsonb NOT NULL,
  occurred_at       timestamptz,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  processing_result varchar(30) CHECK (processing_result IN ('APPLIED','DUPLICATE','IGNORED_STALE','REJECTED','MISMATCH')),
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX payment_events_payment_idx ON payment_events (payment_id, received_at);

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY,
  payment_id         uuid NOT NULL REFERENCES payments(id),
  booking_id         uuid NOT NULL REFERENCES bookings(id),
  amount_xof         bigint NOT NULL CHECK (amount_xof > 0),
  reason_code        varchar(40) NOT NULL
                     CHECK (reason_code IN ('DRIVER_CANCELLED','PASSENGER_CANCELLED','DISPUTE','ADMIN','TRIP_CHANGED','LATE_PAYMENT','TRIP_NOT_STARTED','DRIVER_LATE')),
  status             refund_status NOT NULL DEFAULT 'REQUESTED',
  requested_by       uuid REFERENCES users(id),
  approved_by        uuid REFERENCES users(id),
  provider_reference varchar(100),
  idempotency_key    uuid NOT NULL UNIQUE,
  failure_message    varchar(300),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by)
);
CREATE INDEX refunds_booking_idx ON refunds (booking_id);
CREATE TRIGGER refunds_updated_at BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE commissions (
  id              uuid PRIMARY KEY,
  booking_id      uuid NOT NULL UNIQUE REFERENCES bookings(id),
  driver_id       uuid NOT NULL REFERENCES driver_profiles(user_id),
  gross_xof       bigint NOT NULL CHECK (gross_xof >= 0),
  commission_xof  bigint NOT NULL CHECK (commission_xof >= 0),
  service_fee_xof bigint NOT NULL CHECK (service_fee_xof >= 0),
  driver_net_xof  bigint NOT NULL CHECK (driver_net_xof >= 0),
  adjusted_xof    bigint NOT NULL DEFAULT 0,
  status          varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAYABLE','IN_PAYOUT','PAID','VOID')),
  payable_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (driver_net_xof = gross_xof - commission_xof)
);
CREATE INDEX commissions_driver_idx ON commissions (driver_id, status);
CREATE TRIGGER commissions_updated_at BEFORE UPDATE ON commissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payouts (
  id                 uuid PRIMARY KEY,
  driver_id          uuid NOT NULL REFERENCES driver_profiles(user_id),
  period_start       date NOT NULL,
  period_end         date NOT NULL CHECK (period_end >= period_start),
  amount_xof         bigint NOT NULL CHECK (amount_xof >= 0),
  method             payment_method,
  destination_masked varchar(20),
  status             payout_status NOT NULL DEFAULT 'DRAFT',
  external_reference varchar(100),
  approved_by        uuid REFERENCES users(id),
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payouts_driver_idx ON payouts (driver_id, period_start);

CREATE TABLE payout_items (
  payout_id     uuid NOT NULL REFERENCES payouts(id),
  commission_id uuid NOT NULL UNIQUE REFERENCES commissions(id),
  amount_xof    bigint NOT NULL CHECK (amount_xof >= 0),
  PRIMARY KEY (payout_id, commission_id)
);

-- Grand livre en partie double : débit > 0, crédit < 0, chaque journal_id s'équilibre à 0
CREATE TABLE ledger_entries (
  id          bigserial PRIMARY KEY,
  journal_id  uuid NOT NULL,
  account     varchar(60) NOT NULL,
  amount_xof  bigint NOT NULL CHECK (amount_xof <> 0),
  booking_id  uuid REFERENCES bookings(id),
  payment_id  uuid REFERENCES payments(id),
  refund_id   uuid REFERENCES refunds(id),
  payout_id   uuid REFERENCES payouts(id),
  description varchar(200),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_journal_idx ON ledger_entries (journal_id);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account, created_at);

CREATE TABLE reconciliation_runs (
  id                 uuid PRIMARY KEY,
  provider           varchar(30) NOT NULL,
  period_start       timestamptz NOT NULL,
  period_end         timestamptz NOT NULL CHECK (period_end > period_start),
  status             varchar(20) NOT NULL CHECK (status IN ('RUNNING','OK','DISCREPANCIES','FAILED')),
  internal_total_xof bigint,
  provider_total_xof bigint,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_items (
  id                 uuid PRIMARY KEY,
  run_id             uuid NOT NULL REFERENCES reconciliation_runs(id),
  payment_id         uuid REFERENCES payments(id),
  provider_reference varchar(100),
  issue              varchar(30) NOT NULL CHECK (issue IN ('MISSING_INTERNAL','MISSING_PROVIDER','AMOUNT_MISMATCH','STATUS_MISMATCH')),
  details            jsonb,
  resolved_at        timestamptz,
  resolved_by        uuid REFERENCES users(id),
  resolution_note    varchar(300)
);
CREATE INDEX reconciliation_items_run_idx ON reconciliation_items (run_id);

CREATE TABLE promotion_redemptions (
  id           uuid PRIMARY KEY,
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  booking_id   uuid NOT NULL UNIQUE REFERENCES bookings(id),
  amount_xof   bigint NOT NULL CHECK (amount_xof > 0),
  status       varchar(10) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','USED','RELEASED')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promotion_redemptions_user_idx ON promotion_redemptions (promotion_id, user_id);
