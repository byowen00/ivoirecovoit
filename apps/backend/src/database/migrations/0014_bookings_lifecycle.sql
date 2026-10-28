-- 0014 : cycle de vie des réservations (étape 7)

-- Montants figés à l'annulation (doc 05 §7) : ce qui revient au passager et ce qui reste dû au conducteur.
-- Le remboursement lui-même (prestataire de paiement) est exécuté à l'étape 8 ; il part de ces montants.
ALTER TABLE bookings
  ADD COLUMN refund_due_xof bigint CHECK (refund_due_xof >= 0),
  ADD COLUMN driver_compensation_xof bigint CHECK (driver_compensation_xof >= 0),
  -- Annulation sans frais ouverte au passager (horaire décalé de plus de 30 min, doc 05 §6).
  ADD COLUMN free_cancellation boolean NOT NULL DEFAULT false,
  ADD COLUMN expired_at timestamptz,
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN no_show_at timestamptz,
  ADD CONSTRAINT bookings_refund_le_total CHECK (refund_due_xof IS NULL OR refund_due_xof <= total_xof);

-- Trajet clôturé par le système (12 h après l'arrivée estimée sans déclaration du conducteur).
ALTER TABLE trips ADD COLUMN auto_closed boolean NOT NULL DEFAULT false;

-- Échéances à traiter par la tâche périodique (expiration des blocages).
CREATE INDEX bookings_acceptance_deadline_idx ON bookings (acceptance_deadline) WHERE status = 'PENDING_ACCEPTANCE';
