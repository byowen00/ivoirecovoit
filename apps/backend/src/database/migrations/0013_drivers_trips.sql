-- 0013 : dossiers conducteur et véhicule, documents, machine à états des trajets (étape 6)

-- Dossiers : NOT_SUBMITTED (en préparation) -> PENDING (soumis) -> APPROVED | REJECTED (corrigeable, renvoyable).
ALTER TABLE driver_profiles ADD COLUMN submitted_at timestamptz;

ALTER TABLE vehicles
  ALTER COLUMN verification_status SET DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN rejection_reason varchar(300),
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verified_by uuid REFERENCES users(id);

-- Un document naît à la demande d'URL de dépôt (NOT_SUBMITTED) et passe en PENDING quand le serveur a vérifié
-- le fichier déposé (taille, type réel, empreinte SHA-256).
ALTER TABLE driver_documents
  ALTER COLUMN status SET DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN uploaded_at timestamptz,
  ADD CONSTRAINT driver_documents_uploaded CHECK (status = 'NOT_SUBMITTED' OR uploaded_at IS NOT NULL);
ALTER TABLE vehicle_documents
  ALTER COLUMN status SET DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN uploaded_at timestamptz,
  ADD CONSTRAINT vehicle_documents_uploaded CHECK (status = 'NOT_SUBMITTED' OR uploaded_at IS NOT NULL);

-- Un conducteur ne conduit pas deux trajets en même temps, même avec deux véhicules.
ALTER TABLE trips ADD CONSTRAINT trips_driver_no_overlap EXCLUDE USING gist (
  driver_id WITH =,
  tstzrange(departure_at, estimated_arrival_at) WITH &&
) WHERE (status IN ('PUBLISHED','FULL','IN_PROGRESS'));

-- Machine à états des trajets (doc 05 §1), vérifiée aussi par le service.
CREATE TABLE trip_status_transitions (
  from_status trip_status NOT NULL,
  to_status   trip_status NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO trip_status_transitions (from_status, to_status) VALUES
  ('DRAFT','PUBLISHED'),
  ('DRAFT','CANCELLED'),
  ('PUBLISHED','FULL'),
  ('FULL','PUBLISHED'),
  ('PUBLISHED','IN_PROGRESS'),
  ('FULL','IN_PROGRESS'),
  ('IN_PROGRESS','COMPLETED'),
  ('PUBLISHED','CANCELLED'),
  ('FULL','CANCELLED');

-- Toute modification incrémente la version (verrou optimiste If-Match).
CREATE OR REPLACE FUNCTION trips_check_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('DRAFT','PUBLISHED') THEN
      RAISE EXCEPTION 'Statut initial de trajet invalide : %', NEW.status USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
      SELECT 1 FROM trip_status_transitions WHERE from_status = OLD.status AND to_status = NEW.status) THEN
      RAISE EXCEPTION 'Transition de trajet interdite : % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trips_transition BEFORE INSERT OR UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION trips_check_transition();

-- Occupation maximale d'un trajet sur les segments [from_seq, to_seq) (doc 05 §3). Les réservations en attente
-- dont le blocage a expiré ne comptent plus, même si la tâche d'expiration n'est pas encore passée.
CREATE OR REPLACE FUNCTION trip_max_occupancy(p_trip uuid, p_from integer, p_to integer)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT coalesce(max(occ), 0)::integer FROM (
    SELECT g.seq, coalesce(sum(b.seats), 0) AS occ
      FROM generate_series(p_from, p_to - 1) g(seq)
      LEFT JOIN bookings b ON b.trip_id = p_trip
       AND b.status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT','CONFIRMED')
       AND (b.hold_expires_at IS NULL OR b.hold_expires_at > now() OR b.status = 'CONFIRMED')
       AND b.pickup_seq <= g.seq AND b.dropoff_seq > g.seq
     GROUP BY g.seq) s
$$;

CREATE INDEX trips_vehicle_idx ON trips (vehicle_id) WHERE status IN ('DRAFT','PUBLISHED','FULL','IN_PROGRESS');
