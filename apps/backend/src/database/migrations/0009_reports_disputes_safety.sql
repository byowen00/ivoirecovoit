-- 0009 : signalements, litiges, partage de trajet
CREATE TABLE reports (
  id          uuid PRIMARY KEY,
  reporter_id uuid NOT NULL REFERENCES users(id),
  target_type varchar(20) NOT NULL CHECK (target_type IN ('USER','TRIP','MESSAGE','REVIEW','VEHICLE')),
  target_id   uuid NOT NULL,
  booking_id  uuid REFERENCES bookings(id),
  category    varchar(30) NOT NULL
              CHECK (category IN ('DANGEROUS_DRIVING','HARASSMENT','FRAUD','NO_SHOW','INAPPROPRIATE','OTHER')),
  severity    report_severity NOT NULL,
  description varchar(2000) NOT NULL,
  status      report_status NOT NULL DEFAULT 'OPEN',
  assigned_to uuid REFERENCES users(id),
  resolution  varchar(1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_queue_idx ON reports (status, severity, created_at);
CREATE INDEX reports_target_idx ON reports (target_type, target_id);
CREATE TRIGGER reports_updated_at BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE disputes (
  id                uuid PRIMARY KEY,
  reference         varchar(12) NOT NULL UNIQUE,
  booking_id        uuid NOT NULL REFERENCES bookings(id),
  opened_by         uuid NOT NULL REFERENCES users(id),
  reason_code       varchar(30) NOT NULL
                    CHECK (reason_code IN ('DRIVER_NO_SHOW','PASSENGER_NO_SHOW','TRIP_NOT_DONE','LATE','AMOUNT','OTHER')),
  description       varchar(2000) NOT NULL,
  status            dispute_status NOT NULL DEFAULT 'OPEN',
  assigned_to       uuid REFERENCES users(id),
  decision          varchar(30) CHECK (decision IN ('NO_REFUND','PARTIAL_REFUND','FULL_REFUND','DRIVER_PENALTY')),
  decision_note     varchar(1000),
  refund_id         uuid REFERENCES refunds(id),
  response_deadline timestamptz,
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX disputes_one_open_per_booking ON disputes (booking_id)
  WHERE status NOT IN ('RESOLVED','REJECTED','CLOSED');
CREATE TRIGGER disputes_updated_at BEFORE UPDATE ON disputes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dispute_messages (
  id          uuid PRIMARY KEY,
  dispute_id  uuid NOT NULL REFERENCES disputes(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  body        varchar(2000) NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispute_messages_dispute_idx ON dispute_messages (dispute_id, created_at);

CREATE TABLE trip_shares (
  id          uuid PRIMARY KEY,
  booking_id  uuid REFERENCES bookings(id),
  trip_id     uuid NOT NULL REFERENCES trips(id),
  created_by  uuid NOT NULL REFERENCES users(id),
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
