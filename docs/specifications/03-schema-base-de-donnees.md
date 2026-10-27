# IvoireCovoit : étape 3b, schéma de base de données

> PostgreSQL 16 + PostGIS 3.4. Statut : validé. Ce DDL est la référence de conception. **Les migrations exécutables et testées sont dans le dépôt** (`apps/backend/src/database/migrations/`, étape 4) et font foi en cas d'écart. Écarts introduits à l'étape 4 : `trips.estimated_arrival_at` (nécessaire à la contrainte d'exclusion véhicule), `fee_rules.trip_kind_key` (colonne générée pour l'exclusion), tables `booking_status_transitions`, colonnes `is_demo`, clé étrangère composite garantissant que les arrêts d'une réservation appartiennent au trajet.

## 1. Conventions

- Clés primaires `uuid` (UUID v7 généré par l'application, ordonné dans le temps).
- Horodatages `timestamptz` en UTC ; `created_at`, `updated_at` partout (trigger `set_updated_at`).
- **Montants en `bigint` exprimés en XOF entiers** (le franc CFA n'a pas de subdivision en usage). Aucun `float`/`real` pour l'argent. Contraintes `CHECK (amount >= 0)`. Colonne `currency char(3) DEFAULT 'XOF'` pour l'extension future.
- Pourcentages en **points de base** (`integer`, 1 000 = 10 %), arrondis avec règle explicite (arrondi au franc supérieur pour les frais, inférieur pour le net conducteur, l'écart va à la plateforme et est tracé).
- Coordonnées : `geography(Point, 4326)` + index GiST.
- Statuts : types `ENUM` PostgreSQL (lisibles, contrôlés) ; transitions contrôlées dans l'application **et** par un trigger pour les plus critiques (bookings, payments).
- Suppression : pas de `DELETE` physique sur les données métier ; `deleted_at` / anonymisation. `ON DELETE RESTRICT` par défaut ; `CASCADE` seulement sur des tables enfants purement techniques.
- Téléphones en E.164 (`+2250700000000`).

## 2. Diagramme des relations (simplifié)

```
users 1─┬─* auth_identities          users 1─* sessions
        ├─0..1 driver_profiles 1─* vehicles 1─* vehicle_documents
        │             └─* driver_documents
        ├─* user_consents, emergency_contacts, device_tokens
        ├─* trips (driver) 1─* trip_stops ─ places
        │        └─* bookings (passenger) 1─* booking_passengers
        │                 ├─* booking_status_history
        │                 ├─* payments 1─* payment_events
        │                 │        └─* refunds
        │                 ├─1 commissions
        │                 ├─* reviews
        │                 ├─0..1 conversations 1─* messages
        │                 └─* disputes 1─* dispute_messages
        ├─* notifications, reports
        └─* staff_role_assignments ─ staff_roles
payouts 1─* payout_items ─ commissions
promotions 1─* promotion_redemptions ─ bookings
fee_rules (versionnées), settings, cancellation_policies
ledger_entries, reconciliation_runs 1─* reconciliation_items
audit_logs, outbox_events, idempotency_keys, trip_shares, route_cache
```

## 3. Types énumérés

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- recherche floue des lieux
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- contrainte d'exclusion véhicule
CREATE EXTENSION IF NOT EXISTS citext;      -- e-mails et codes promo insensibles à la casse

CREATE TYPE user_status          AS ENUM ('PENDING_VERIFICATION','ACTIVE','SUSPENDED','BANNED','DELETED');
CREATE TYPE verification_status  AS ENUM ('NOT_SUBMITTED','PENDING','APPROVED','REJECTED','EXPIRED');
CREATE TYPE document_type        AS ENUM ('NATIONAL_ID','PASSPORT','CONSULAR_CARD','DRIVING_LICENSE',
                                          'VEHICLE_REGISTRATION','INSURANCE','TECHNICAL_INSPECTION','VEHICLE_PHOTO');
CREATE TYPE place_kind           AS ENUM ('CITY','COMMUNE','NEIGHBORHOOD','LANDMARK','STATION');
CREATE TYPE trip_status          AS ENUM ('DRAFT','PUBLISHED','FULL','IN_PROGRESS','COMPLETED','CANCELLED');
CREATE TYPE trip_kind            AS ENUM ('URBAN','INTERCITY');
CREATE TYPE acceptance_mode      AS ENUM ('AUTO','MANUAL');
CREATE TYPE booking_status       AS ENUM ('PENDING_ACCEPTANCE','PENDING_PAYMENT','CONFIRMED','REJECTED',
                                          'EXPIRED','CANCELLED_BY_PASSENGER','CANCELLED_BY_DRIVER',
                                          'CANCELLED_BY_ADMIN','NO_SHOW','COMPLETED');
CREATE TYPE booking_payment_status AS ENUM ('NOT_REQUIRED','UNPAID','PROCESSING','PAID','PARTIALLY_REFUNDED',
                                            'REFUND_PENDING','REFUNDED','CASH_DUE');
CREATE TYPE payment_method       AS ENUM ('WAVE','ORANGE_MONEY','MTN_MOMO','MOOV_MONEY','CASH');
CREATE TYPE payment_status       AS ENUM ('CREATED','PENDING','SUCCEEDED','FAILED','EXPIRED','CANCELLED');
CREATE TYPE refund_status        AS ENUM ('REQUESTED','APPROVED','PROCESSING','SUCCEEDED','FAILED','REJECTED','MANUAL_REQUIRED');
CREATE TYPE payout_status        AS ENUM ('DRAFT','APPROVED','PROCESSING','PAID','FAILED','CANCELLED');
CREATE TYPE report_status        AS ENUM ('OPEN','IN_REVIEW','ACTION_TAKEN','DISMISSED');
CREATE TYPE report_severity      AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE dispute_status       AS ENUM ('OPEN','AWAITING_RESPONSE','IN_REVIEW','RESOLVED','REJECTED','CLOSED');
CREATE TYPE notification_channel AS ENUM ('IN_APP','PUSH','SMS','WHATSAPP','EMAIL');
CREATE TYPE discount_type        AS ENUM ('FIXED','PERCENT');
```

## 4. Tables

### 4.1 Utilisateurs, authentification, personnel

```sql
CREATE TABLE users (
  id                 uuid PRIMARY KEY,
  phone_e164         varchar(16) UNIQUE,                 -- NULL après anonymisation
  phone_verified_at  timestamptz,
  email              citext UNIQUE,                       -- extension citext
  email_verified_at  timestamptz,
  first_name         varchar(60) NOT NULL,
  last_name          varchar(60) NOT NULL,
  display_name       varchar(80) GENERATED ALWAYS AS (first_name || ' ' || left(last_name,1) || '.') STORED,
  photo_object_key   text,
  bio                varchar(300),
  preferences        jsonb NOT NULL DEFAULT '{}',          -- fumeur, musique, animaux, discussion
  locale             varchar(10) NOT NULL DEFAULT 'fr-CI',
  country_code       char(2) NOT NULL DEFAULT 'CI',
  status             user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  is_passenger       boolean NOT NULL DEFAULT true,
  rating_avg_passenger numeric(3,2),
  rating_count_passenger integer NOT NULL DEFAULT 0,
  suspended_until    timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_identities (               -- téléphone, e-mail, Google, Apple
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  provider     varchar(20) NOT NULL,           -- PHONE | EMAIL | GOOGLE | APPLE
  provider_uid varchar(255) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id),
  refresh_token_hash bytea NOT NULL UNIQUE,
  family_id          uuid NOT NULL,           -- rotation : réutilisation => révocation de la famille
  device_label       varchar(100),
  ip_created         inet,
  user_agent         varchar(300),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  replaced_by        uuid REFERENCES sessions(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);
CREATE INDEX ON sessions (user_id) WHERE revoked_at IS NULL;

-- OTP : stockés dans Redis (hash, compteur d'essais, TTL), pas en base.
-- Seules les tentatives agrégées sont tracées ici pour l'anti-abus et l'audit.
CREATE TABLE otp_requests_log (
  id          bigserial PRIMARY KEY,
  phone_e164  varchar(16) NOT NULL,
  ip          inet,
  purpose     varchar(20) NOT NULL,            -- LOGIN | SIGNUP | PHONE_CHANGE
  outcome     varchar(20) NOT NULL,            -- SENT | VERIFIED | FAILED | BLOCKED
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_requests_log (phone_e164, created_at DESC);

CREATE TABLE user_consents (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  consent_type varchar(30) NOT NULL,           -- TERMS | PRIVACY | LOCATION_LIVE | MARKETING
  version     varchar(20) NOT NULL,
  granted     boolean NOT NULL,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE emergency_contacts (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  name        varchar(80) NOT NULL,
  phone_e164  varchar(16) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_tokens (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  platform    varchar(10) NOT NULL,            -- ANDROID | IOS | WEB
  fcm_token   text NOT NULL UNIQUE,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- Personnel : comptes distincts recommandés, liés à users pour l'audit uniforme
CREATE TABLE staff_accounts (
  user_id        uuid PRIMARY KEY REFERENCES users(id),
  password_hash  text NOT NULL,               -- Argon2id
  totp_secret_enc bytea NOT NULL,             -- chiffré (clé applicative)
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz
);
CREATE TABLE staff_roles (
  code        varchar(30) PRIMARY KEY,         -- SUPPORT | ADMIN | FINANCE | SUPER_ADMIN
  permissions text[] NOT NULL                  -- ex. {'bookings.read','disputes.manage'}
);
CREATE TABLE staff_role_assignments (
  user_id     uuid NOT NULL REFERENCES staff_accounts(user_id),
  role_code   varchar(30) NOT NULL REFERENCES staff_roles(code),
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_code)
);
```

`passenger_profiles` : non nécessaire au MVP, les attributs passager (note, préférences) sont dans `users`.

### 4.2 Conducteurs, véhicules, documents

```sql
CREATE TABLE driver_profiles (
  user_id              uuid PRIMARY KEY REFERENCES users(id),
  verification_status  verification_status NOT NULL DEFAULT 'NOT_SUBMITTED',
  verification_level   smallint NOT NULL DEFAULT 0 CHECK (verification_level BETWEEN 0 AND 2),
  license_number_enc   bytea,                  -- chiffré au niveau applicatif
  license_expires_on   date,
  rejection_reason     varchar(300),
  verified_at          timestamptz,
  verified_by          uuid REFERENCES users(id),
  rating_avg           numeric(3,2),
  rating_count         integer NOT NULL DEFAULT 0,
  completed_trips_count integer NOT NULL DEFAULT 0,
  cancellation_count_90d integer NOT NULL DEFAULT 0,
  is_professional      boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id                 uuid PRIMARY KEY,
  driver_id          uuid NOT NULL REFERENCES driver_profiles(user_id),
  make               varchar(40) NOT NULL,
  model              varchar(40) NOT NULL,
  color              varchar(30) NOT NULL,
  year               smallint CHECK (year BETWEEN 1980 AND 2100),
  plate_number       varchar(15) NOT NULL,
  plate_normalized   varchar(15) GENERATED ALWAYS AS (upper(regexp_replace(plate_number,'[^A-Za-z0-9]','','g'))) STORED,
  seats_capacity     smallint NOT NULL CHECK (seats_capacity BETWEEN 1 AND 8),  -- places passagers
  verification_status verification_status NOT NULL DEFAULT 'PENDING',
  is_active          boolean NOT NULL DEFAULT true,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vehicles_plate_active_uq ON vehicles (plate_normalized) WHERE deleted_at IS NULL;

CREATE TABLE vehicle_documents (
  id             uuid PRIMARY KEY,
  vehicle_id     uuid NOT NULL REFERENCES vehicles(id),
  doc_type       document_type NOT NULL CHECK (doc_type IN ('VEHICLE_REGISTRATION','INSURANCE','TECHNICAL_INSPECTION','VEHICLE_PHOTO')),
  object_key     text NOT NULL,               -- clé dans le bucket privé, jamais d'URL publique
  mime_type      varchar(50) NOT NULL,
  size_bytes     integer NOT NULL CHECK (size_bytes <= 8388608),
  sha256         bytea NOT NULL,
  expires_on     date,
  status         verification_status NOT NULL DEFAULT 'PENDING',
  rejection_reason varchar(300),
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON vehicle_documents (vehicle_id, doc_type);

CREATE TABLE driver_documents (               -- pièces d'identité et permis
  id             uuid PRIMARY KEY,
  driver_id      uuid NOT NULL REFERENCES driver_profiles(user_id),
  doc_type       document_type NOT NULL CHECK (doc_type IN ('NATIONAL_ID','PASSPORT','CONSULAR_CARD','DRIVING_LICENSE')),
  side           varchar(5) CHECK (side IN ('FRONT','BACK')),
  object_key     text NOT NULL,
  mime_type      varchar(50) NOT NULL,
  size_bytes     integer NOT NULL CHECK (size_bytes <= 8388608),
  sha256         bytea NOT NULL,
  expires_on     date,
  status         verification_status NOT NULL DEFAULT 'PENDING',
  rejection_reason varchar(300),
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

### 4.3 Lieux, trajets, arrêts

```sql
CREATE TABLE places (                          -- référentiel géré par l'admin
  id            uuid PRIMARY KEY,
  kind          place_kind NOT NULL,
  name          varchar(120) NOT NULL,            -- « Cocody », « Riviera 2 », « Gare UTB Adjamé »
  parent_id     uuid REFERENCES places(id),        -- quartier -> commune -> ville
  aliases       text[] NOT NULL DEFAULT '{}',      -- « Bassam », « Yakro »
  search_text   text NOT NULL,                     -- unaccent(lower(nom + alias + parent)) maintenu par trigger
  location      geography(Point,4326) NOT NULL,
  country_code  char(2) NOT NULL DEFAULT 'CI',
  population_rank integer,                          -- pour classer l'autocomplétion
  is_active     boolean NOT NULL DEFAULT true
);
CREATE INDEX places_location_gix ON places USING gist (location);
CREATE INDEX places_search_trgm  ON places USING gin (search_text gin_trgm_ops);

CREATE TABLE cancellation_policies (
  code          varchar(20) PRIMARY KEY,           -- FLEXIBLE | STANDARD | STRICT
  label         varchar(60) NOT NULL,
  rules         jsonb NOT NULL,                    -- paliers, voir doc 05
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE trips (
  id                 uuid PRIMARY KEY,
  public_ref         varchar(12) NOT NULL UNIQUE,  -- « T-8F2K4M »
  driver_id          uuid NOT NULL REFERENCES driver_profiles(user_id),
  vehicle_id         uuid NOT NULL REFERENCES vehicles(id),
  kind               trip_kind NOT NULL,
  status             trip_status NOT NULL DEFAULT 'DRAFT',
  departure_at       timestamptz NOT NULL,         -- heure de départ de l'origine
  seats_offered      smallint NOT NULL CHECK (seats_offered BETWEEN 1 AND 8),
  acceptance_mode    acceptance_mode NOT NULL DEFAULT 'AUTO',
  cancellation_policy_code varchar(20) NOT NULL REFERENCES cancellation_policies(code),
  allows_cash        boolean NOT NULL DEFAULT false,
  luggage_policy     varchar(20) NOT NULL DEFAULT 'MEDIUM', -- NONE | SMALL | MEDIUM | LARGE
  description        varchar(1000),
  instructions       varchar(500),
  estimated_distance_m integer,                    -- issu du routage, estimation
  estimated_duration_s integer,
  route_geometry     geography(LineString,4326),   -- itinéraire estimé simplifié
  route_source       varchar(20),                  -- OSRM | HAVERSINE_FALLBACK
  source_trip_id     uuid REFERENCES trips(id),    -- duplication
  published_at       timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancellation_reason varchar(300),
  version            integer NOT NULL DEFAULT 1,   -- verrou optimiste pour les éditions
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trips_completed_after_start CHECK (completed_at IS NULL OR started_at IS NOT NULL)
);
CREATE INDEX trips_search_idx ON trips (status, departure_at) WHERE status IN ('PUBLISHED','FULL');
CREATE INDEX trips_driver_idx ON trips (driver_id, departure_at DESC);
CREATE INDEX trips_route_gix  ON trips USING gist (route_geometry);

-- Un même véhicule ne peut pas avoir deux trajets actifs qui se chevauchent
ALTER TABLE trips ADD CONSTRAINT trips_vehicle_no_overlap EXCLUDE USING gist (
  vehicle_id WITH =,
  tstzrange(departure_at, departure_at + make_interval(secs => coalesce(estimated_duration_s, 3600)) ) WITH &&
) WHERE (status IN ('PUBLISHED','FULL','IN_PROGRESS'));

CREATE TABLE trip_stops (                      -- origine (seq 0), arrêts, destination (seq max)
  id             uuid PRIMARY KEY,
  trip_id        uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seq            smallint NOT NULL CHECK (seq BETWEEN 0 AND 6),
  place_id       uuid REFERENCES places(id),
  label          varchar(120) NOT NULL,          -- « Riviera 2, carrefour Las Palmas »
  meeting_point  varchar(200),                   -- repère précis
  location       geography(Point,4326) NOT NULL,
  location_precision varchar(10) NOT NULL DEFAULT 'EXACT', -- EXACT | APPROX (centre de quartier)
  planned_at     timestamptz NOT NULL,           -- heure estimée de passage
  price_from_origin_xof bigint NOT NULL CHECK (price_from_origin_xof >= 0), -- cumul : prix(seg a->b) = p[b]-p[a]
  is_pickup      boolean NOT NULL DEFAULT true,
  is_dropoff     boolean NOT NULL DEFAULT true,
  UNIQUE (trip_id, seq)
);
CREATE INDEX trip_stops_location_gix ON trip_stops USING gist (location);
CREATE INDEX trip_stops_trip_idx ON trip_stops (trip_id, seq);
```

### 4.4 Réservations

```sql
CREATE TABLE bookings (
  id                 uuid PRIMARY KEY,
  reference          varchar(10) NOT NULL UNIQUE,         -- « IC-7K3P9Q », alphabet sans 0/O/1/I
  trip_id            uuid NOT NULL REFERENCES trips(id),
  passenger_id       uuid NOT NULL REFERENCES users(id),
  pickup_stop_id     uuid NOT NULL REFERENCES trip_stops(id),
  dropoff_stop_id    uuid NOT NULL REFERENCES trip_stops(id),
  pickup_seq         smallint NOT NULL,                    -- dénormalisé pour le calcul d'occupation
  dropoff_seq        smallint NOT NULL,
  seats              smallint NOT NULL CHECK (seats BETWEEN 1 AND 8),
  status             booking_status NOT NULL,
  payment_status     booking_payment_status NOT NULL DEFAULT 'UNPAID',
  payment_method     payment_method,
  -- Montants figés au moment de la réservation (XOF entiers)
  unit_price_xof     bigint NOT NULL CHECK (unit_price_xof >= 0),
  subtotal_xof       bigint NOT NULL CHECK (subtotal_xof = unit_price_xof * seats),
  service_fee_xof    bigint NOT NULL CHECK (service_fee_xof >= 0),
  discount_xof       bigint NOT NULL DEFAULT 0 CHECK (discount_xof >= 0),
  total_xof          bigint NOT NULL CHECK (total_xof = subtotal_xof + service_fee_xof - discount_xof AND total_xof >= 0),
  commission_xof     bigint NOT NULL CHECK (commission_xof >= 0),
  driver_net_xof     bigint NOT NULL CHECK (driver_net_xof = subtotal_xof - commission_xof),
  fee_rule_id        uuid NOT NULL,                        -- version des règles appliquées
  promotion_id       uuid,
  cancellation_policy_code varchar(20) NOT NULL REFERENCES cancellation_policies(code),
  hold_expires_at    timestamptz,                          -- fin du blocage temporaire
  acceptance_deadline timestamptz,
  accepted_at        timestamptz,
  confirmed_at       timestamptz,
  cancelled_at       timestamptz,
  cancelled_by       uuid REFERENCES users(id),
  cancellation_reason varchar(300),
  completed_at       timestamptz,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (dropoff_seq > pickup_seq)
);
-- Un passager n'a qu'une réservation active par trajet (anti double réservation)
CREATE UNIQUE INDEX bookings_one_active_per_trip
  ON bookings (trip_id, passenger_id)
  WHERE status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT','CONFIRMED');
CREATE INDEX bookings_trip_active_idx ON bookings (trip_id) WHERE status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT','CONFIRMED');
CREATE INDEX bookings_passenger_idx ON bookings (passenger_id, created_at DESC);
CREATE INDEX bookings_hold_expiry_idx ON bookings (hold_expires_at) WHERE status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT');

CREATE TABLE booking_passengers (              -- personnes supplémentaires identifiées (facultatif)
  id           uuid PRIMARY KEY,
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  full_name    varchar(120) NOT NULL,
  phone_e164   varchar(16),
  is_booker    boolean NOT NULL DEFAULT false,
  no_show      boolean
);

CREATE TABLE booking_status_history (
  id           bigserial PRIMARY KEY,
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  from_status  booking_status,
  to_status    booking_status NOT NULL,
  actor_id     uuid REFERENCES users(id),     -- NULL = système
  reason       varchar(300),
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

### 4.5 Paiements, remboursements, commissions, comptabilité

```sql
CREATE TABLE payments (
  id                  uuid PRIMARY KEY,       -- envoyé au prestataire comme référence marchand
  booking_id          uuid NOT NULL REFERENCES bookings(id),
  provider            varchar(30) NOT NULL,   -- sandbox | <agrégateur>
  method              payment_method NOT NULL,
  amount_xof          bigint NOT NULL CHECK (amount_xof > 0),
  currency            char(3) NOT NULL DEFAULT 'XOF',
  status              payment_status NOT NULL DEFAULT 'CREATED',
  provider_reference  varchar(100),
  payer_phone_masked  varchar(20),            -- « +225 07 •• •• 12 » ; jamais de PIN
  idempotency_key     uuid NOT NULL UNIQUE,
  failure_code        varchar(50),
  failure_message     varchar(300),
  expires_at          timestamptz NOT NULL,
  succeeded_at        timestamptz,
  provider_fee_xof    bigint,                 -- frais du prestataire si communiqués
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_reference)
);
-- Au plus un paiement réussi par réservation
CREATE UNIQUE INDEX payments_one_success_per_booking ON payments (booking_id) WHERE status = 'SUCCEEDED';
-- Au plus un paiement en cours par réservation
CREATE UNIQUE INDEX payments_one_pending_per_booking ON payments (booking_id) WHERE status IN ('CREATED','PENDING');

CREATE TABLE payment_events (                 -- webhooks et interrogations, en ajout seul
  id                  uuid PRIMARY KEY,
  payment_id          uuid REFERENCES payments(id),  -- NULL si non rattaché (alerte)
  provider            varchar(30) NOT NULL,
  provider_event_id   varchar(150) NOT NULL,
  source              varchar(10) NOT NULL,          -- WEBHOOK | POLL | MANUAL
  event_type          varchar(50) NOT NULL,
  reported_status     varchar(30),
  amount_xof          bigint,
  signature_valid     boolean NOT NULL,
  raw_payload         jsonb NOT NULL,                -- expurgé des données sensibles
  occurred_at         timestamptz,                   -- horodatage du prestataire
  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  processing_result   varchar(30),                   -- APPLIED | DUPLICATE | IGNORED_STALE | REJECTED | MISMATCH
  UNIQUE (provider, provider_event_id)               -- idempotence des webhooks répétés
);

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY,
  payment_id         uuid NOT NULL REFERENCES payments(id),
  booking_id         uuid NOT NULL REFERENCES bookings(id),
  amount_xof         bigint NOT NULL CHECK (amount_xof > 0),
  reason_code        varchar(40) NOT NULL,   -- DRIVER_CANCELLED | PASSENGER_CANCELLED | DISPUTE | ADMIN | TRIP_CHANGED
  status             refund_status NOT NULL DEFAULT 'REQUESTED',
  requested_by       uuid REFERENCES users(id),
  approved_by        uuid REFERENCES users(id),
  provider_reference varchar(100),
  idempotency_key    uuid NOT NULL UNIQUE,
  failure_message    varchar(300),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Trigger : somme des remboursements non rejetés <= montant du paiement réussi

CREATE TABLE fee_rules (                      -- versionnées, jamais modifiées après usage
  id                    uuid PRIMARY KEY,
  effective_from        timestamptz NOT NULL,
  effective_to          timestamptz,
  trip_kind             trip_kind,             -- NULL = tous
  commission_bps        integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  commission_fixed_xof  bigint NOT NULL DEFAULT 0,
  commission_min_xof    bigint NOT NULL DEFAULT 0,
  commission_max_xof    bigint,
  service_fee_bps       integer NOT NULL DEFAULT 0 CHECK (service_fee_bps BETWEEN 0 AND 10000),
  service_fee_fixed_xof bigint NOT NULL DEFAULT 0,
  service_fee_min_xof   bigint NOT NULL DEFAULT 0,
  service_fee_max_xof   bigint,
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  is_demo               boolean NOT NULL DEFAULT false   -- valeurs de démonstration identifiées
);
ALTER TABLE bookings ADD FOREIGN KEY (fee_rule_id) REFERENCES fee_rules(id);

CREATE TABLE commissions (                    -- une ligne par réservation payée, figée
  id               uuid PRIMARY KEY,
  booking_id       uuid NOT NULL UNIQUE REFERENCES bookings(id),
  driver_id        uuid NOT NULL REFERENCES driver_profiles(user_id),
  gross_xof        bigint NOT NULL,           -- subtotal (part trajet)
  commission_xof   bigint NOT NULL,
  service_fee_xof  bigint NOT NULL,
  driver_net_xof   bigint NOT NULL,
  adjusted_xof     bigint NOT NULL DEFAULT 0, -- après annulation partielle / litige
  status           varchar(20) NOT NULL DEFAULT 'PENDING', -- PENDING (trajet non terminé) | PAYABLE | IN_PAYOUT | PAID | VOID
  payable_at       timestamptz,               -- fin du trajet + délai de contestation
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payouts (                        -- relevés / versements aux conducteurs
  id              uuid PRIMARY KEY,
  driver_id       uuid NOT NULL REFERENCES driver_profiles(user_id),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  amount_xof      bigint NOT NULL CHECK (amount_xof >= 0),
  method          payment_method,
  destination_masked varchar(20),
  status          payout_status NOT NULL DEFAULT 'DRAFT',
  external_reference varchar(100),
  approved_by     uuid REFERENCES users(id),
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payout_items (
  payout_id      uuid NOT NULL REFERENCES payouts(id),
  commission_id  uuid NOT NULL UNIQUE REFERENCES commissions(id),
  amount_xof     bigint NOT NULL,
  PRIMARY KEY (payout_id, commission_id)
);

CREATE TABLE ledger_entries (                 -- grand livre en partie double, ajout seul
  id            bigserial PRIMARY KEY,
  journal_id    uuid NOT NULL,                -- regroupe les écritures d'une opération (somme = 0)
  account       varchar(40) NOT NULL,         -- PROVIDER_CLEARING | DRIVER_PAYABLE:<id> | PLATFORM_REVENUE_COMMISSION | PLATFORM_REVENUE_FEES | PROMO_EXPENSE | REFUNDS
  amount_xof    bigint NOT NULL,              -- débit > 0, crédit < 0
  booking_id    uuid REFERENCES bookings(id),
  payment_id    uuid REFERENCES payments(id),
  refund_id     uuid REFERENCES refunds(id),
  payout_id     uuid REFERENCES payouts(id),
  description   varchar(200),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ledger_entries (journal_id);
-- Contrainte différée (trigger de fin de transaction) : SUM(amount_xof) = 0 par journal_id

CREATE TABLE reconciliation_runs (
  id            uuid PRIMARY KEY,
  provider      varchar(30) NOT NULL,
  period_start  timestamptz NOT NULL,
  period_end    timestamptz NOT NULL,
  status        varchar(20) NOT NULL,        -- RUNNING | OK | DISCREPANCIES | FAILED
  internal_total_xof bigint,
  provider_total_xof bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reconciliation_items (
  id            uuid PRIMARY KEY,
  run_id        uuid NOT NULL REFERENCES reconciliation_runs(id),
  payment_id    uuid REFERENCES payments(id),
  provider_reference varchar(100),
  issue         varchar(30) NOT NULL,        -- MISSING_INTERNAL | MISSING_PROVIDER | AMOUNT_MISMATCH | STATUS_MISMATCH
  details       jsonb,
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES users(id),
  resolution_note varchar(300)
);
```

### 4.6 Promotions

```sql
CREATE TABLE promotions (
  id               uuid PRIMARY KEY,
  code             citext NOT NULL UNIQUE,
  description      varchar(200),
  discount_type    discount_type NOT NULL,
  discount_value   bigint NOT NULL CHECK (discount_value > 0),   -- XOF ou points de base
  max_discount_xof bigint,
  min_total_xof    bigint NOT NULL DEFAULT 0,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL CHECK (ends_at > starts_at),
  max_redemptions  integer,
  max_per_user     integer NOT NULL DEFAULT 1,
  redemptions_count integer NOT NULL DEFAULT 0,
  first_trip_only  boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bookings ADD FOREIGN KEY (promotion_id) REFERENCES promotions(id);

CREATE TABLE promotion_redemptions (
  id            uuid PRIMARY KEY,
  promotion_id  uuid NOT NULL REFERENCES promotions(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  booking_id    uuid NOT NULL UNIQUE REFERENCES bookings(id),
  amount_xof    bigint NOT NULL,
  status        varchar(10) NOT NULL DEFAULT 'RESERVED', -- RESERVED | USED | RELEASED
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### 4.7 Avis, messagerie, notifications

```sql
CREATE TABLE reviews (
  id            uuid PRIMARY KEY,
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  author_id     uuid NOT NULL REFERENCES users(id),
  subject_id    uuid NOT NULL REFERENCES users(id),
  direction     varchar(20) NOT NULL CHECK (direction IN ('PASSENGER_TO_DRIVER','DRIVER_TO_PASSENGER')),
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       varchar(500),
  published_at  timestamptz,                -- publication simultanée ou à J+14
  hidden_at     timestamptz,                -- modération
  hidden_reason varchar(200),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, author_id),
  CHECK (author_id <> subject_id)
);
CREATE INDEX ON reviews (subject_id, published_at DESC);

CREATE TABLE conversations (
  id           uuid PRIMARY KEY,
  booking_id   uuid NOT NULL UNIQUE REFERENCES bookings(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz                  -- fermée 7 jours après le trajet
);
CREATE TABLE messages (
  id               uuid PRIMARY KEY,
  conversation_id  uuid NOT NULL REFERENCES conversations(id),
  sender_id        uuid NOT NULL REFERENCES users(id),
  body             varchar(1000) NOT NULL,
  was_redacted     boolean NOT NULL DEFAULT false,   -- numéro/lien masqué
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (conversation_id, created_at);

CREATE TABLE notifications (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  type          varchar(50) NOT NULL,       -- BOOKING_REQUESTED, PAYMENT_CONFIRMED, TRIP_REMINDER_24H…
  title         varchar(120) NOT NULL,
  body          varchar(400) NOT NULL,
  data          jsonb NOT NULL DEFAULT '{}', -- lien profond, identifiants
  channels      notification_channel[] NOT NULL,
  dedupe_key    varchar(150) UNIQUE,         -- évite les doublons (ex. rappel 24 h par réservation)
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC);

CREATE TABLE notification_deliveries (
  id              bigserial PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         notification_channel NOT NULL,
  status          varchar(20) NOT NULL,     -- QUEUED | SENT | FAILED | SKIPPED
  provider_message_id varchar(150),
  error           varchar(300),
  attempts        smallint NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

### 4.8 Signalements, litiges, sécurité

```sql
CREATE TABLE reports (
  id             uuid PRIMARY KEY,
  reporter_id    uuid NOT NULL REFERENCES users(id),
  target_type    varchar(20) NOT NULL CHECK (target_type IN ('USER','TRIP','MESSAGE','REVIEW','VEHICLE')),
  target_id      uuid NOT NULL,
  booking_id     uuid REFERENCES bookings(id),
  category       varchar(30) NOT NULL,     -- DANGEROUS_DRIVING | HARASSMENT | FRAUD | NO_SHOW | INAPPROPRIATE | OTHER
  severity       report_severity NOT NULL,
  description    varchar(2000) NOT NULL,
  status         report_status NOT NULL DEFAULT 'OPEN',
  assigned_to    uuid REFERENCES users(id),
  resolution     varchar(1000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON reports (status, severity, created_at);

CREATE TABLE disputes (
  id             uuid PRIMARY KEY,
  reference      varchar(12) NOT NULL UNIQUE,
  booking_id     uuid NOT NULL REFERENCES bookings(id),
  opened_by      uuid NOT NULL REFERENCES users(id),
  reason_code    varchar(30) NOT NULL,     -- DRIVER_NO_SHOW | PASSENGER_NO_SHOW | TRIP_NOT_DONE | LATE | AMOUNT | OTHER
  description    varchar(2000) NOT NULL,
  status         dispute_status NOT NULL DEFAULT 'OPEN',
  assigned_to    uuid REFERENCES users(id),
  decision       varchar(30),              -- NO_REFUND | PARTIAL_REFUND | FULL_REFUND | DRIVER_PENALTY
  decision_note  varchar(1000),
  refund_id      uuid REFERENCES refunds(id),
  response_deadline timestamptz,
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX disputes_one_open_per_booking ON disputes (booking_id) WHERE status NOT IN ('RESOLVED','REJECTED','CLOSED');

CREATE TABLE dispute_messages (
  id           uuid PRIMARY KEY,
  dispute_id   uuid NOT NULL REFERENCES disputes(id),
  author_id    uuid NOT NULL REFERENCES users(id),
  body         varchar(2000) NOT NULL,
  is_internal  boolean NOT NULL DEFAULT false,   -- note visible du personnel seulement
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trip_shares (                      -- partage avec un proche
  id            uuid PRIMARY KEY,
  booking_id    uuid REFERENCES bookings(id),
  trip_id       uuid NOT NULL REFERENCES trips(id),
  created_by    uuid NOT NULL REFERENCES users(id),
  token_hash    bytea NOT NULL UNIQUE,          -- jeton aléatoire 32 octets, seul le hash est stocké
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### 4.9 Paramètres, audit, technique

```sql
CREATE TABLE settings (                         -- paramètres versionnés clé/valeur
  key          varchar(60) NOT NULL,            -- booking.hold_minutes, cash.enabled, emergency.numbers…
  value        jsonb NOT NULL,
  version      integer NOT NULL,
  updated_by   uuid NOT NULL REFERENCES users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, version)
);

CREATE TABLE audit_logs (                       -- ajout seul (trigger refusant UPDATE/DELETE)
  id            bigserial PRIMARY KEY,
  actor_id      uuid REFERENCES users(id),     -- NULL = système
  actor_role    varchar(30),
  action        varchar(60) NOT NULL,          -- user.suspend, document.view, refund.approve, settings.update…
  target_type   varchar(30),
  target_id     uuid,
  reason        varchar(500),                  -- obligatoire pour les accès sensibles
  changes       jsonb,                         -- avant/après sans données sensibles en clair
  ip            inet,
  user_agent    varchar(300),
  request_id    varchar(50),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX ON audit_logs (actor_id, created_at DESC);

CREATE TABLE idempotency_keys (
  key            uuid NOT NULL,
  user_id        uuid NOT NULL REFERENCES users(id),
  endpoint       varchar(100) NOT NULL,
  request_hash   bytea NOT NULL,
  response_code  smallint,
  response_body  jsonb,
  locked_until   timestamptz,                  -- requête en cours de traitement
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE outbox_events (                    -- pattern transactional outbox
  id            bigserial PRIMARY KEY,
  aggregate     varchar(30) NOT NULL,
  aggregate_id  uuid NOT NULL,
  event_type    varchar(60) NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX ON outbox_events (created_at) WHERE published_at IS NULL;

CREATE TABLE route_cache (
  key           varchar(80) PRIMARY KEY,        -- hash des points arrondis à 3 décimales
  distance_m    integer NOT NULL,
  duration_s    integer NOT NULL,
  geometry      geography(LineString,4326),
  source        varchar(20) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

## 5. Requête de recherche (principe)

```sql
-- :from / :to = points (lieu choisi), :r1 / :r2 = rayons en mètres, :day_start/:day_end en UTC
SELECT t.id, s1.seq AS pickup_seq, s2.seq AS dropoff_seq,
       s2.price_from_origin_xof - s1.price_from_origin_xof AS unit_price_xof,
       ST_Distance(s1.location, :from) AS pickup_distance_m
FROM trips t
JOIN trip_stops s1 ON s1.trip_id = t.id AND s1.is_pickup
                   AND ST_DWithin(s1.location, :from, :r1)          -- index GiST
JOIN trip_stops s2 ON s2.trip_id = t.id AND s2.is_dropoff AND s2.seq > s1.seq
                   AND ST_DWithin(s2.location, :to, :r2)
WHERE t.status = 'PUBLISHED'
  AND s1.planned_at BETWEEN :day_start AND :day_end
  AND (s2.price_from_origin_xof - s1.price_from_origin_xof) <= :max_price
-- puis filtre « places restantes sur le segment [pickup_seq, dropoff_seq) >= :seats » (doc 05 §3),
-- DISTINCT ON (t.id) en gardant le meilleur couple d'arrêts, tri, pagination par curseur.
```

Le filtre `direct uniquement` impose `s1.seq = 0` et `s2.seq = max(seq)` sans arrêt intermédiaire (trajet à 2 points).

## 6. Suppression, archivage et conservation des données (proposition à faire valider juridiquement)

| Donnée | Durée de conservation | À l'échéance |
|---|---|---|
| Compte actif | Tant que le compte existe | — |
| Compte supprimé à la demande | Anonymisation immédiate (nom → « Utilisateur supprimé », téléphone/e-mail/photo effacés) | Lignes conservées pour l'intégrité des réservations |
| Documents d'identité et permis | Durée de validité du profil conducteur + 6 mois après fermeture ou rejet définitif | Suppression de l'objet et de la ligne |
| Documents véhicule | Idem | Idem |
| Réservations, paiements, remboursements, commissions, grand livre | 10 ans (obligations comptables, durée à confirmer selon l'Acte uniforme OHADA) | Archivage froid |
| Webhooks bruts (`payment_events.raw_payload`) | 2 ans | Purge du JSON, conservation des champs normalisés |
| Messages | 1 an après le trajet, sauf litige ouvert | Suppression |
| Litiges et signalements | 5 ans après clôture | Anonymisation |
| Position en direct (I2) | 7 jours après le trajet, sauf litige | Suppression |
| Journaux d'audit | 5 ans | Archivage |
| Logs applicatifs | 30 jours | Rotation |
| `otp_requests_log` | 90 jours | Purge |
| Sessions révoquées/expirées | 30 jours | Purge |

Les purges sont des tâches planifiées journalisées. Une demande de suppression est refusée temporairement si une réservation est en cours ou un litige ouvert (l'utilisateur en est informé).

## 7. Migrations prévues (étape 4)

1. `0001_extensions_and_enums`
2. `0002_users_auth_staff`
3. `0003_drivers_vehicles_documents`
4. `0004_places_policies_trips_stops` (+ contrainte d'exclusion)
5. `0005_fee_rules_promotions`
6. `0006_bookings`
7. `0007_payments_refunds_commissions_ledger_payouts_reconciliation`
8. `0008_reviews_messaging_notifications`
9. `0009_reports_disputes_safety`
10. `0010_settings_audit_idempotency_outbox_cache`
11. `0011_triggers` (updated_at, audit en ajout seul, transitions de statut, équilibre du grand livre, plafond des remboursements)
12. `seed_reference` (lieux CI, politiques d'annulation, rôles du personnel) et `seed_demo` séparé (données `[DEMO]`)
