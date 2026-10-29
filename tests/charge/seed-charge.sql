-- Jeu de données de CHARGE (étape 10) : 50 000 trajets publiés FICTIFS pour mesurer la recherche (ENF-01).
-- À charger UNIQUEMENT dans une base dédiée aux tests de charge, jamais en production :
--   psql "$LOAD_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/charge/seed-charge.sql
-- Tout est marqué is_demo = true et préfixé « [CHARGE] ». Numéros dans la plage +225 0001 xx xx xx,
-- attribuée à aucun abonné. Distances et durées : vol d'oiseau × 1,3 à 60 km/h, de simples estimations.
-- 2 000 conducteurs et véhicules, 25 trajets chacun (un par jour, sans chevauchement) ; 40 % des trajets
-- partent d'un quartier ou d'une commune d'Abidjan, comme on peut s'y attendre au lancement.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE lt_places AS
  SELECT row_number() OVER (ORDER BY name) - 1 AS n, id, name, location,
         (parent_id IS NOT NULL AND kind IN ('COMMUNE','NEIGHBORHOOD','STATION')) AS abidjan
    FROM places WHERE is_active AND name <> 'Abidjan';
CREATE TEMP TABLE lt_counts AS
  SELECT count(*) FILTER (WHERE abidjan) AS na, count(*) FILTER (WHERE NOT abidjan) AS nc FROM lt_places;
CREATE TEMP TABLE lt_abj AS SELECT row_number() OVER (ORDER BY n) - 1 AS i, * FROM lt_places WHERE abidjan;
CREATE TEMP TABLE lt_city AS SELECT row_number() OVER (ORDER BY n) - 1 AS i, * FROM lt_places WHERE NOT abidjan;

CREATE TEMP TABLE lt_drivers AS
  SELECT d, gen_random_uuid() AS user_id, gen_random_uuid() AS vehicle_id FROM generate_series(1, 2000) d;

INSERT INTO users (id, phone_e164, phone_verified_at, first_name, last_name, status, is_demo)
  SELECT user_id, '+2250001' || lpad(d::text, 6, '0'), now(), '[CHARGE] Conducteur', 'N° ' || d, 'ACTIVE', true
    FROM lt_drivers;
INSERT INTO driver_profiles (user_id, verification_status, verification_level, verified_at, submitted_at, license_expires_on)
  SELECT user_id, 'APPROVED', 2, now(), now(), (now() + interval '3 years')::date FROM lt_drivers;
INSERT INTO vehicles (id, driver_id, make, model, color, plate_number, seats_capacity, verification_status)
  SELECT vehicle_id, user_id, 'Toyota', 'Corolla', 'Gris', 'LT-' || lpad(d::text, 4, '0') || '-CI', 4, 'APPROVED'
    FROM lt_drivers;
INSERT INTO vehicle_documents (id, vehicle_id, doc_type, object_key, mime_type, size_bytes, sha256, expires_on, status,
                               uploaded_at, reviewed_at)
  SELECT gen_random_uuid(), vehicle_id, t::document_type, 'demo/absent', 'image/jpeg', 1, '\x00',
         CASE WHEN t = 'VEHICLE_REGISTRATION' THEN NULL ELSE (now() + interval '1 year')::date END, 'APPROVED', now(), now()
    FROM lt_drivers, unnest(ARRAY['VEHICLE_REGISTRATION','INSURANCE','TECHNICAL_INSPECTION']::text[]) t;

-- Un trajet par conducteur et par jour (J+1 à J+25), départ entre 5 h et 14 h UTC (= heure d'Abidjan).
CREATE TEMP TABLE lt_trips AS
  SELECT gen_random_uuid() AS id, d.d, k, d.user_id, d.vehicle_id,
         date_trunc('day', now()) + k * interval '1 day' + ((d.d % 10) + 5) * interval '1 hour' AS departure_at,
         (d.d * 31 + k * 17) % 10 < 4 AS from_abidjan,
         (d.d + k) % 3 = 0 AS with_middle,
         (d.d * 7 + k * 3) AS h1, (d.d * 13 + k * 5 + 1) AS h2, (d.d * 11 + k * 19 + 2) AS h3,
         (d.d % 2 = 0) AS auto
    FROM lt_drivers d, generate_series(1, 25) k;

CREATE TEMP TABLE lt_stops AS
  WITH picks AS (
    SELECT t.id, t.with_middle,
           CASE WHEN t.from_abidjan THEN (SELECT a.id FROM lt_abj a, lt_counts c WHERE a.i = t.h1 % c.na)
                ELSE (SELECT x.id FROM lt_city x, lt_counts c WHERE x.i = t.h1 % c.nc) END AS o,
           (SELECT x.id FROM lt_city x, lt_counts c WHERE x.i = t.h3 % c.nc) AS m,
           (SELECT x.id FROM lt_city x, lt_counts c WHERE x.i = (t.h2 + CASE WHEN t.h2 % c.nc = t.h1 % c.nc THEN 1 ELSE 0 END) % c.nc) AS dst
      FROM lt_trips t)
  SELECT id, 0 AS seq, o AS place_id FROM picks
  UNION ALL SELECT id, 1, m FROM picks WHERE with_middle AND m <> o AND m <> dst
  UNION ALL SELECT p.id, CASE WHEN p.with_middle AND p.m <> p.o AND p.m <> p.dst THEN 2 ELSE 1 END, p.dst FROM picks p;

CREATE TEMP TABLE lt_legs AS
  SELECT s.id AS trip_id, s.seq, s.place_id, p.name, p.location,
         coalesce(ST_Distance(lag(p.location) OVER w, p.location), 0) * 1.3 AS leg_m
    FROM lt_stops s JOIN places p ON p.id = s.place_id
  WINDOW w AS (PARTITION BY s.id ORDER BY s.seq);
CREATE TEMP TABLE lt_legs2 AS
  SELECT *, sum(leg_m) OVER (PARTITION BY trip_id ORDER BY seq) AS cum_m,
         count(*) OVER (PARTITION BY trip_id) AS nstops
    FROM lt_legs;

-- Durée estimée plafonnée à 16 h (les arrêts intermédiaires tirés au hasard peuvent faire des détours).
CREATE TEMP TABLE lt_tot AS
  SELECT trip_id, max(cum_m) AS total_m,
         least(57600, greatest(600, round(max(cum_m) / 1000 / 60 * 3600)))::int AS dur_s,
         ST_MakeLine(location::geometry ORDER BY seq)::geography AS line
    FROM lt_legs2 GROUP BY trip_id;

INSERT INTO trips (id, public_ref, driver_id, vehicle_id, kind, status, departure_at, estimated_arrival_at, seats_offered,
                   acceptance_mode, cancellation_policy_code, description, estimated_distance_m, estimated_duration_s,
                   route_source, is_demo, published_at, route_geometry)
  SELECT t.id, 'LT' || lpad(((t.d - 1) * 25 + t.k)::text, 8, '0'), t.user_id, t.vehicle_id,
         CASE WHEN g.total_m > 40000 THEN 'INTERCITY' ELSE 'URBAN' END::trip_kind, 'PUBLISHED', t.departure_at,
         t.departure_at + g.dur_s * interval '1 second',
         3 + (t.d % 2), CASE WHEN t.auto THEN 'AUTO' ELSE 'MANUAL' END::acceptance_mode,
         (ARRAY['FLEXIBLE','STANDARD','STRICT'])[1 + t.d % 3], '[CHARGE] Trajet fictif pour les tests de charge.',
         round(g.total_m)::int, g.dur_s, 'HAVERSINE_FALLBACK', true, now(), g.line
    FROM lt_trips t JOIN lt_tot g ON g.trip_id = t.id;

INSERT INTO trip_stops (id, trip_id, seq, place_id, label, meeting_point, location, location_precision, planned_at,
                        price_from_origin_xof, is_pickup, is_dropoff)
  SELECT gen_random_uuid(), l.trip_id, l.seq, l.place_id, l.name, '[CHARGE] Point fictif', l.location, 'APPROX',
         t.departure_at + round(g.dur_s * l.cum_m / greatest(g.total_m, 1))::int * interval '1 second',
         (round(l.cum_m / 1000 * 25 / 50) * 50)::bigint + CASE WHEN l.seq > 0 THEN 500 ELSE 0 END,
         l.seq < l.nstops - 1, l.seq > 0
    FROM lt_legs2 l JOIN lt_trips t ON t.id = l.trip_id JOIN lt_tot g ON g.trip_id = l.trip_id;

COMMIT;
ANALYZE users; ANALYZE trips; ANALYZE trip_stops; ANALYZE vehicles;
SELECT count(*) AS trajets_publies FROM trips WHERE status = 'PUBLISHED';
