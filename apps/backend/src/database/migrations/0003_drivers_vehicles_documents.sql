-- 0003 : conducteurs, véhicules, documents
CREATE TABLE driver_profiles (
  user_id                uuid PRIMARY KEY REFERENCES users(id),
  verification_status    verification_status NOT NULL DEFAULT 'NOT_SUBMITTED',
  verification_level     smallint NOT NULL DEFAULT 0 CHECK (verification_level BETWEEN 0 AND 2),
  license_number_enc     bytea,
  license_expires_on     date,
  rejection_reason       varchar(300),
  verified_at            timestamptz,
  verified_by            uuid REFERENCES users(id),
  rating_avg             numeric(3,2) CHECK (rating_avg BETWEEN 1 AND 5),
  rating_count           integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  completed_trips_count  integer NOT NULL DEFAULT 0 CHECK (completed_trips_count >= 0),
  cancellation_count_90d integer NOT NULL DEFAULT 0 CHECK (cancellation_count_90d >= 0),
  is_professional        boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER driver_profiles_updated_at BEFORE UPDATE ON driver_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vehicles (
  id                  uuid PRIMARY KEY,
  driver_id           uuid NOT NULL REFERENCES driver_profiles(user_id),
  make                varchar(40) NOT NULL,
  model               varchar(40) NOT NULL,
  color               varchar(30) NOT NULL,
  year                smallint CHECK (year BETWEEN 1980 AND 2100),
  plate_number        varchar(15) NOT NULL,
  plate_normalized    varchar(15) GENERATED ALWAYS AS (upper(regexp_replace(plate_number, '[^A-Za-z0-9]', '', 'g'))) STORED,
  seats_capacity      smallint NOT NULL CHECK (seats_capacity BETWEEN 1 AND 8),
  verification_status verification_status NOT NULL DEFAULT 'PENDING',
  is_active           boolean NOT NULL DEFAULT true,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vehicles_plate_active_uq ON vehicles (plate_normalized) WHERE deleted_at IS NULL;
CREATE INDEX vehicles_driver_idx ON vehicles (driver_id);
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vehicle_documents (
  id               uuid PRIMARY KEY,
  vehicle_id       uuid NOT NULL REFERENCES vehicles(id),
  doc_type         document_type NOT NULL
                   CHECK (doc_type IN ('VEHICLE_REGISTRATION','INSURANCE','TECHNICAL_INSPECTION','VEHICLE_PHOTO')),
  object_key       text NOT NULL,
  mime_type        varchar(50) NOT NULL,
  size_bytes       integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  sha256           bytea NOT NULL,
  expires_on       date,
  status           verification_status NOT NULL DEFAULT 'PENDING',
  rejection_reason varchar(300),
  reviewed_by      uuid REFERENCES users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_documents_vehicle_idx ON vehicle_documents (vehicle_id, doc_type);

CREATE TABLE driver_documents (
  id               uuid PRIMARY KEY,
  driver_id        uuid NOT NULL REFERENCES driver_profiles(user_id),
  doc_type         document_type NOT NULL
                   CHECK (doc_type IN ('NATIONAL_ID','PASSPORT','CONSULAR_CARD','DRIVING_LICENSE')),
  side             varchar(5) CHECK (side IN ('FRONT','BACK')),
  object_key       text NOT NULL,
  mime_type        varchar(50) NOT NULL,
  size_bytes       integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  sha256           bytea NOT NULL,
  expires_on       date,
  status           verification_status NOT NULL DEFAULT 'PENDING',
  rejection_reason varchar(300),
  reviewed_by      uuid REFERENCES users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_documents_driver_idx ON driver_documents (driver_id, doc_type);
