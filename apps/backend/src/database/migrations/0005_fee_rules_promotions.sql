-- 0005 : règles de frais et de commission (versionnées), promotions
CREATE TABLE fee_rules (
  id                    uuid PRIMARY KEY,
  effective_from        timestamptz NOT NULL,
  effective_to          timestamptz,
  trip_kind             trip_kind,                       -- NULL = tous les types de trajet
  trip_kind_key         text GENERATED ALWAYS AS (
                          CASE WHEN trip_kind = 'URBAN' THEN 'URBAN'
                               WHEN trip_kind = 'INTERCITY' THEN 'INTERCITY'
                               ELSE '*' END) STORED,
  commission_bps        integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  commission_fixed_xof  bigint NOT NULL DEFAULT 0 CHECK (commission_fixed_xof >= 0),
  commission_min_xof    bigint NOT NULL DEFAULT 0 CHECK (commission_min_xof >= 0),
  commission_max_xof    bigint CHECK (commission_max_xof >= commission_min_xof),
  service_fee_bps       integer NOT NULL DEFAULT 0 CHECK (service_fee_bps BETWEEN 0 AND 10000),
  service_fee_fixed_xof bigint NOT NULL DEFAULT 0 CHECK (service_fee_fixed_xof >= 0),
  service_fee_min_xof   bigint NOT NULL DEFAULT 0 CHECK (service_fee_min_xof >= 0),
  service_fee_max_xof   bigint CHECK (service_fee_max_xof >= service_fee_min_xof),
  created_by            uuid REFERENCES users(id),
  is_demo               boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- Deux versions pour le même type de trajet ne peuvent pas se chevaucher dans le temps.
  -- Une règle spécifique (URBAN/INTERCITY) l'emporte sur une règle générale ('*') : choix fait par l'application.
  EXCLUDE USING gist (
    trip_kind_key WITH =,
    tstzrange(effective_from, coalesce(effective_to, 'infinity')) WITH &&
  )
);

CREATE TABLE promotions (
  id                uuid PRIMARY KEY,
  code              citext NOT NULL UNIQUE,
  description       varchar(200),
  discount_type     discount_type NOT NULL,
  discount_value    bigint NOT NULL CHECK (discount_value > 0),
  max_discount_xof  bigint CHECK (max_discount_xof > 0),
  min_total_xof     bigint NOT NULL DEFAULT 0 CHECK (min_total_xof >= 0),
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  max_redemptions   integer CHECK (max_redemptions > 0),
  max_per_user      integer NOT NULL DEFAULT 1 CHECK (max_per_user > 0),
  redemptions_count integer NOT NULL DEFAULT 0 CHECK (redemptions_count >= 0),
  first_trip_only   boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  is_demo           boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (discount_type <> 'PERCENT' OR discount_value <= 10000),
  CHECK (max_redemptions IS NULL OR redemptions_count <= max_redemptions)
);
