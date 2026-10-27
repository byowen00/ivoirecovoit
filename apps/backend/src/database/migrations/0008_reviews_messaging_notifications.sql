-- 0008 : avis, messagerie, notifications
CREATE TABLE reviews (
  id            uuid PRIMARY KEY,
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  author_id     uuid NOT NULL REFERENCES users(id),
  subject_id    uuid NOT NULL REFERENCES users(id),
  direction     varchar(20) NOT NULL CHECK (direction IN ('PASSENGER_TO_DRIVER','DRIVER_TO_PASSENGER')),
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       varchar(500),
  published_at  timestamptz,
  hidden_at     timestamptz,
  hidden_reason varchar(200),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, author_id),
  CHECK (author_id <> subject_id)
);
CREATE INDEX reviews_subject_idx ON reviews (subject_id, published_at DESC);

CREATE TABLE conversations (
  id         uuid PRIMARY KEY,
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at  timestamptz
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  sender_id       uuid NOT NULL REFERENCES users(id),
  body            varchar(1000) NOT NULL CHECK (length(btrim(body)) > 0),
  was_redacted    boolean NOT NULL DEFAULT false,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  type       varchar(50) NOT NULL,
  title      varchar(120) NOT NULL,
  body       varchar(400) NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  channels   notification_channel[] NOT NULL,
  dedupe_key varchar(150) UNIQUE,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_deliveries (
  id                  bigserial PRIMARY KEY,
  notification_id     uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel             notification_channel NOT NULL,
  status              varchar(20) NOT NULL CHECK (status IN ('QUEUED','SENT','FAILED','SKIPPED')),
  provider_message_id varchar(150),
  error               varchar(300),
  attempts            smallint NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_deliveries_notification_idx ON notification_deliveries (notification_id);
