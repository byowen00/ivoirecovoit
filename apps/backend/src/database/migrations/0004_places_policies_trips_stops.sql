-- 0004 : référentiel des lieux, politiques d'annulation, trajets, arrêts
CREATE TABLE places (
  id              uuid PRIMARY KEY,
  kind            place_kind NOT NULL,
  name            varchar(120) NOT NULL,
  parent_id       uuid REFERENCES places(id),
  aliases         text[] NOT NULL DEFAULT '{}',
  search_text     text NOT NULL DEFAULT '',
  location        geography(Point, 4326) NOT NULL,
  location_precision varchar(10) NOT NULL DEFAULT 'APPROX' CHECK (location_precision IN ('EXACT','APPROX')),
  country_code    char(2) NOT NULL DEFAULT 'CI',
  population_rank integer,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (parent_id, name)
);
CREATE INDEX places_location_gix ON places USING gist (location);
CREATE INDEX places_search_trgm ON places USING gin (search_text gin_trgm_ops);

-- search_text = nom + alias + nom du parent, sans accents, en minuscules
CREATE OR REPLACE FUNCTION places_set_search_text() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_name text;
BEGIN
  SELECT name INTO parent_name FROM places WHERE id = NEW.parent_id;
  NEW.search_text := normalize_search(
    concat_ws(' ', NEW.name, array_to_string(NEW.aliases, ' '), parent_name));
  RETURN NEW;
END $$;
CREATE TRIGGER places_search_text BEFORE INSERT OR UPDATE OF name, aliases, parent_id ON places
  FOR EACH ROW EXECUTE FUNCTION places_set_search_text();

CREATE TABLE cancellation_policies (
  code      varchar(20) PRIMARY KEY,
  label     varchar(60) NOT NULL,
  rules     jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE trips (
  id                       uuid PRIMARY KEY,
  public_ref               varchar(12) NOT NULL UNIQUE,
  driver_id                uuid NOT NULL REFERENCES driver_profiles(user_id),
  vehicle_id               uuid NOT NULL REFERENCES vehicles(id),
  kind                     trip_kind NOT NULL,
  status                   trip_status NOT NULL DEFAULT 'DRAFT',
  departure_at             timestamptz NOT NULL,
  -- Arrivée estimée (routage) ; sert aussi à empêcher deux trajets simultanés pour un même véhicule.
  estimated_arrival_at     timestamptz NOT NULL,
  seats_offered            smallint NOT NULL CHECK (seats_offered BETWEEN 1 AND 8),
  acceptance_mode          acceptance_mode NOT NULL DEFAULT 'AUTO',
  cancellation_policy_code varchar(20) NOT NULL REFERENCES cancellation_policies(code),
  allows_cash              boolean NOT NULL DEFAULT false,
  luggage_policy           varchar(20) NOT NULL DEFAULT 'MEDIUM' CHECK (luggage_policy IN ('NONE','SMALL','MEDIUM','LARGE')),
  description              varchar(1000),
  instructions             varchar(500),
  estimated_distance_m     integer CHECK (estimated_distance_m >= 0),
  estimated_duration_s     integer CHECK (estimated_duration_s >= 0),
  route_geometry           geography(LineString, 4326),
  route_source             varchar(20) CHECK (route_source IN ('OSRM','HAVERSINE_FALLBACK')),
  source_trip_id           uuid REFERENCES trips(id),
  is_demo                  boolean NOT NULL DEFAULT false,
  published_at             timestamptz,
  started_at               timestamptz,
  completed_at             timestamptz,
  cancelled_at             timestamptz,
  cancellation_reason      varchar(300),
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trips_arrival_after_departure CHECK (estimated_arrival_at > departure_at),
  CONSTRAINT trips_completed_after_start CHECK (completed_at IS NULL OR started_at IS NOT NULL),
  CONSTRAINT trips_vehicle_no_overlap EXCLUDE USING gist (
    vehicle_id WITH =,
    tstzrange(departure_at, estimated_arrival_at) WITH &&
  ) WHERE (status IN ('PUBLISHED','FULL','IN_PROGRESS'))
);
CREATE INDEX trips_search_idx ON trips (status, departure_at) WHERE status IN ('PUBLISHED','FULL');
CREATE INDEX trips_driver_idx ON trips (driver_id, departure_at DESC);
CREATE INDEX trips_route_gix ON trips USING gist (route_geometry);
CREATE TRIGGER trips_updated_at BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE trip_stops (
  id                    uuid PRIMARY KEY,
  trip_id               uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seq                   smallint NOT NULL CHECK (seq BETWEEN 0 AND 6),
  place_id              uuid REFERENCES places(id),
  label                 varchar(120) NOT NULL,
  meeting_point         varchar(200),
  location              geography(Point, 4326) NOT NULL,
  location_precision    varchar(10) NOT NULL DEFAULT 'EXACT' CHECK (location_precision IN ('EXACT','APPROX')),
  planned_at            timestamptz NOT NULL,
  -- Prix cumulé depuis l'origine : prix du segment a->b = p[b] - p[a]
  price_from_origin_xof bigint NOT NULL CHECK (price_from_origin_xof >= 0 AND price_from_origin_xof % 50 = 0),
  is_pickup             boolean NOT NULL DEFAULT true,
  is_dropoff            boolean NOT NULL DEFAULT true,
  UNIQUE (trip_id, seq),
  UNIQUE (id, trip_id)
);
CREATE INDEX trip_stops_location_gix ON trip_stops USING gist (location);
