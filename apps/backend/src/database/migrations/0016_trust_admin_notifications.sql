-- 0016 : étape 9 : notifications, messagerie, avis, signalements, litiges, partage, promotions, administration

-- Remboursements décidés par le personnel : note, auteur du refus, double validation.
ALTER TABLE refunds
  ADD COLUMN note        varchar(500),
  ADD COLUMN rejected_by uuid REFERENCES users(id),
  ADD COLUMN decided_at  timestamptz,
  ADD CONSTRAINT refunds_approver_differs CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by);
CREATE INDEX refunds_status_idx ON refunds (status, created_at);

-- Notes internes du personnel (fiches utilisateurs, trajets, réservations) : jamais visibles des utilisateurs.
CREATE TABLE staff_notes (
  id          uuid PRIMARY KEY,
  target_type varchar(20) NOT NULL CHECK (target_type IN ('USER','TRIP','BOOKING')),
  target_id   uuid NOT NULL,
  author_id   uuid NOT NULL REFERENCES users(id),
  body        varchar(2000) NOT NULL CHECK (length(btrim(body)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_notes_target_idx ON staff_notes (target_type, target_id, created_at DESC);

-- Avis : publication différée (les deux parties ont noté, ou fin du délai), masquage par le personnel.
ALTER TABLE reviews ADD COLUMN hidden_by uuid REFERENCES users(id);
CREATE INDEX reviews_unpublished_idx ON reviews (created_at) WHERE published_at IS NULL;

-- Messagerie : lecture par destinataire ; un message masqué par le personnel garde sa trace.
ALTER TABLE messages
  ADD COLUMN hidden_at  timestamptz,
  ADD COLUMN hidden_by  uuid REFERENCES users(id);

-- Litiges : réponse attendue de l'autre partie, montant décidé.
ALTER TABLE disputes
  ADD COLUMN respondent_id      uuid REFERENCES users(id),
  ADD COLUMN decided_by         uuid REFERENCES users(id),
  ADD COLUMN decided_refund_xof bigint CHECK (decided_refund_xof >= 0);
CREATE INDEX disputes_queue_idx ON disputes (status, created_at);

-- Partage de trajet : un seul lien actif par réservation et par personne.
CREATE UNIQUE INDEX trip_shares_one_active ON trip_shares (booking_id, created_by) WHERE revoked_at IS NULL;

-- Promotions : désactivation tracée ; plafonds par appareil non gérés (identifiant d'appareil non fiable à ce stade).
ALTER TABLE promotions
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN deactivated_by uuid REFERENCES users(id);
CREATE TRIGGER promotions_updated_at BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Notifications : file d'envoi sur le téléphone.
CREATE INDEX notification_deliveries_queue_idx ON notification_deliveries (updated_at) WHERE status = 'QUEUED';
ALTER TABLE device_tokens ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- Exports CSV : trace de chaque fichier produit (le fichier lui-même est dans le stockage privé, durée limitée).
CREATE TABLE exports (
  id          uuid PRIMARY KEY,
  type        varchar(30) NOT NULL CHECK (type IN ('TRANSACTIONS','BOOKINGS','REFUNDS','COMMISSIONS')),
  period_from timestamptz NOT NULL,
  period_to   timestamptz NOT NULL CHECK (period_to > period_from),
  row_count   integer NOT NULL CHECK (row_count >= 0),
  object_key  text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Cycle de vie d'un code promo réservé avec une réservation (doc 05 §3 et §5.3) :
-- payé -> utilisé ; abandonné sans paiement (expirée, refusée, annulée) -> libéré, compteur rendu.
CREATE OR REPLACE FUNCTION bookings_promotion_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.promotion_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.payment_status = 'PAID' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
    UPDATE promotion_redemptions SET status = 'USED' WHERE booking_id = NEW.id AND status = 'RESERVED';
  ELSIF NEW.status IN ('EXPIRED','REJECTED','CANCELLED_BY_PASSENGER','CANCELLED_BY_DRIVER','CANCELLED_BY_ADMIN')
        AND OLD.status IS DISTINCT FROM NEW.status
        AND NEW.payment_status NOT IN ('PAID','PARTIALLY_REFUNDED','REFUNDED','REFUND_PENDING') THEN
    WITH released AS (
      UPDATE promotion_redemptions SET status = 'RELEASED'
       WHERE booking_id = NEW.id AND status IN ('RESERVED','USED') RETURNING promotion_id
    )
    UPDATE promotions p SET redemptions_count = p.redemptions_count - 1 FROM released r WHERE p.id = r.promotion_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_promotion AFTER UPDATE OF status, payment_status ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_promotion_lifecycle();
