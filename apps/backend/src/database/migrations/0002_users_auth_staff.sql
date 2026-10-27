-- 0002 : utilisateurs, authentification, personnel
CREATE TABLE users (
  id                     uuid PRIMARY KEY,
  phone_e164             varchar(16) UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at      timestamptz,
  email                  citext UNIQUE,
  email_verified_at      timestamptz,
  first_name             varchar(60) NOT NULL,
  last_name              varchar(60) NOT NULL,
  display_name           varchar(80) GENERATED ALWAYS AS (first_name || ' ' || left(last_name, 1) || '.') STORED,
  photo_object_key       text,
  bio                    varchar(300),
  preferences            jsonb NOT NULL DEFAULT '{}',
  locale                 varchar(10) NOT NULL DEFAULT 'fr-CI',
  country_code           char(2) NOT NULL DEFAULT 'CI',
  status                 user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  is_passenger           boolean NOT NULL DEFAULT true,
  is_demo                boolean NOT NULL DEFAULT false,
  rating_avg_passenger   numeric(3,2) CHECK (rating_avg_passenger BETWEEN 1 AND 5),
  rating_count_passenger integer NOT NULL DEFAULT 0 CHECK (rating_count_passenger >= 0),
  suspended_until        timestamptz,
  deleted_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE auth_identities (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  provider     varchar(20) NOT NULL CHECK (provider IN ('PHONE','EMAIL','GOOGLE','APPLE')),
  provider_uid varchar(255) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id),
  refresh_token_hash bytea NOT NULL UNIQUE,
  family_id          uuid NOT NULL,
  device_label       varchar(100),
  ip_created         inet,
  user_agent         varchar(300),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  replaced_by        uuid REFERENCES sessions(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id);

-- Les codes OTP eux-mêmes vivent dans Redis (hachés, avec TTL). Ce journal sert à l'anti-abus et à l'audit.
CREATE TABLE otp_requests_log (
  id          bigserial PRIMARY KEY,
  phone_e164  varchar(16) NOT NULL,
  ip          inet,
  purpose     varchar(20) NOT NULL CHECK (purpose IN ('LOGIN','SIGNUP','PHONE_CHANGE','ACCOUNT_DELETION')),
  outcome     varchar(20) NOT NULL CHECK (outcome IN ('SENT','VERIFIED','FAILED','BLOCKED')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_requests_log_phone_idx ON otp_requests_log (phone_e164, created_at DESC);

CREATE TABLE user_consents (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  consent_type varchar(30) NOT NULL CHECK (consent_type IN ('TERMS','PRIVACY','LOCATION_LIVE','MARKETING')),
  version      varchar(20) NOT NULL,
  granted      boolean NOT NULL,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_consents_user_idx ON user_consents (user_id, consent_type, created_at DESC);

CREATE TABLE emergency_contacts (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL UNIQUE REFERENCES users(id),
  name        varchar(80) NOT NULL,
  phone_e164  varchar(16) NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_tokens (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  platform     varchar(10) NOT NULL CHECK (platform IN ('ANDROID','IOS','WEB')),
  fcm_token    text NOT NULL UNIQUE,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id);

CREATE TABLE staff_accounts (
  user_id          uuid PRIMARY KEY REFERENCES users(id),
  password_hash    text NOT NULL,
  totp_secret_enc  bytea NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  last_login_at    timestamptz
);

CREATE TABLE staff_roles (
  code        varchar(30) PRIMARY KEY,
  label       varchar(60) NOT NULL,
  permissions text[] NOT NULL
);

CREATE TABLE staff_role_assignments (
  user_id     uuid NOT NULL REFERENCES staff_accounts(user_id),
  role_code   varchar(30) NOT NULL REFERENCES staff_roles(code),
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_code)
);
