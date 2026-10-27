-- 0010 : paramètres versionnés, audit, idempotence, outbox, cache de routage
CREATE TABLE settings (
  key        varchar(60) NOT NULL,
  value      jsonb NOT NULL,
  version    integer NOT NULL CHECK (version > 0),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, version)
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  actor_role  varchar(30),
  action      varchar(60) NOT NULL,
  target_type varchar(30),
  target_id   uuid,
  reason      varchar(500),
  changes     jsonb,
  ip          inet,
  user_agent  varchar(300),
  request_id  varchar(50),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);

CREATE TABLE idempotency_keys (
  key           uuid NOT NULL,
  user_id       uuid NOT NULL REFERENCES users(id),
  endpoint      varchar(100) NOT NULL,
  request_hash  bytea NOT NULL,
  response_code smallint,
  response_body jsonb,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

CREATE TABLE outbox_events (
  id           bigserial PRIMARY KEY,
  aggregate    varchar(30) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type   varchar(60) NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL;

CREATE TABLE route_cache (
  key        varchar(80) PRIMARY KEY,
  distance_m integer NOT NULL CHECK (distance_m >= 0),
  duration_s integer NOT NULL CHECK (duration_s >= 0),
  geometry   geography(LineString, 4326),
  source     varchar(20) NOT NULL CHECK (source IN ('OSRM','HAVERSINE_FALLBACK')),
  created_at timestamptz NOT NULL DEFAULT now()
);
