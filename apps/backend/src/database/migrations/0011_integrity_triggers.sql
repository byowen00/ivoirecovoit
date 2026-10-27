-- 0011 : déclencheurs d'intégrité (deuxième ligne de défense après les services applicatifs)

-- 1. Journal d'audit en ajout seul
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs est en ajout seul (% interdit)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER payment_events_no_delete BEFORE DELETE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

-- 2. Transitions de statut des réservations (doc 05 §2)
CREATE TABLE booking_status_transitions (
  from_status booking_status NOT NULL,
  to_status   booking_status NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO booking_status_transitions (from_status, to_status) VALUES
  ('PENDING_ACCEPTANCE','PENDING_PAYMENT'),
  ('PENDING_ACCEPTANCE','CONFIRMED'),            -- espèces
  ('PENDING_ACCEPTANCE','REJECTED'),
  ('PENDING_ACCEPTANCE','EXPIRED'),
  ('PENDING_ACCEPTANCE','CANCELLED_BY_PASSENGER'),
  ('PENDING_ACCEPTANCE','CANCELLED_BY_DRIVER'),
  ('PENDING_ACCEPTANCE','CANCELLED_BY_ADMIN'),
  ('PENDING_PAYMENT','CONFIRMED'),
  ('PENDING_PAYMENT','EXPIRED'),
  ('PENDING_PAYMENT','CANCELLED_BY_PASSENGER'),
  ('PENDING_PAYMENT','CANCELLED_BY_DRIVER'),
  ('PENDING_PAYMENT','CANCELLED_BY_ADMIN'),
  ('EXPIRED','CONFIRMED'),                       -- paiement vérifié arrivé en retard, places encore libres (§5.4)
  ('CONFIRMED','COMPLETED'),
  ('CONFIRMED','NO_SHOW'),
  ('CONFIRMED','CANCELLED_BY_PASSENGER'),
  ('CONFIRMED','CANCELLED_BY_DRIVER'),
  ('CONFIRMED','CANCELLED_BY_ADMIN');

CREATE OR REPLACE FUNCTION bookings_check_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT','CONFIRMED') THEN
      RAISE EXCEPTION 'Statut initial de réservation invalide : %', NEW.status USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (SELECT 1 FROM booking_status_transitions
                   WHERE from_status = OLD.status AND to_status = NEW.status) THEN
      RAISE EXCEPTION 'Transition de réservation interdite : % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_transition BEFORE INSERT OR UPDATE OF status ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_check_transition();

-- Historique automatique ; l'application renseigne l'acteur via SET LOCAL app.actor_id / app.reason
CREATE OR REPLACE FUNCTION bookings_record_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO booking_status_history (booking_id, from_status, to_status, actor_id, reason)
    VALUES (NEW.id,
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
            NEW.status,
            nullif(current_setting('app.actor_id', true), '')::uuid,
            nullif(current_setting('app.reason', true), ''));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER bookings_history AFTER INSERT OR UPDATE OF status ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_record_history();

-- 3. Transitions des paiements : un état final ne régresse pas,
--    sauf FAILED/EXPIRED -> SUCCEEDED (le prestataire confirme après coup, il fait foi)
CREATE OR REPLACE FUNCTION payments_check_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'CREATED' AND NEW.status IN ('PENDING','SUCCEEDED','FAILED','EXPIRED','CANCELLED')) OR
      (OLD.status = 'PENDING' AND NEW.status IN ('SUCCEEDED','FAILED','EXPIRED','CANCELLED')) OR
      (OLD.status IN ('FAILED','EXPIRED') AND NEW.status = 'SUCCEEDED')
    ) THEN
      RAISE EXCEPTION 'Transition de paiement interdite : % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.status = 'SUCCEEDED' AND NEW.amount_xof <> OLD.amount_xof THEN
    RAISE EXCEPTION 'Le montant d''un paiement réussi ne peut pas changer' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_transition BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_check_transition();

-- 4. Somme des remboursements non rejetés/échoués <= montant du paiement réussi
CREATE OR REPLACE FUNCTION refunds_check_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid bigint; refunded bigint;
BEGIN
  SELECT amount_xof INTO paid FROM payments WHERE id = NEW.payment_id AND status = 'SUCCEEDED' FOR UPDATE;
  IF paid IS NULL THEN
    RAISE EXCEPTION 'Remboursement impossible : paiement non réussi' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(amount_xof), 0) INTO refunded FROM refunds
   WHERE payment_id = NEW.payment_id AND id <> NEW.id AND status NOT IN ('REJECTED','FAILED');
  IF NEW.status NOT IN ('REJECTED','FAILED') AND refunded + NEW.amount_xof > paid THEN
    RAISE EXCEPTION 'Remboursements (% XOF) supérieurs au montant payé (% XOF)', refunded + NEW.amount_xof, paid
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refunds_cap BEFORE INSERT OR UPDATE OF amount_xof, status ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_check_cap();

-- 5. Grand livre : chaque journal doit être équilibré à la fin de la transaction
CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance bigint;
BEGIN
  SELECT sum(amount_xof) INTO balance FROM ledger_entries WHERE journal_id = NEW.journal_id;
  IF balance <> 0 THEN
    RAISE EXCEPTION 'Journal comptable % déséquilibré (solde % XOF)', NEW.journal_id, balance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();
