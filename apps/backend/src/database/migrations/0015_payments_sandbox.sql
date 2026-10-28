-- 0015 : paiement (étape 8) : bac à sable interne, prolongation du blocage, détail des remboursements

-- Répartition figée à l'annulation : frais de service rendus (le reste du remboursement est la part trajet)
-- et motif du remboursement (doc 05 §7). Utilisés pour la commission et le grand livre.
ALTER TABLE bookings
  ADD COLUMN service_fee_refund_xof bigint CHECK (service_fee_refund_xof >= 0),
  ADD COLUMN refund_reason varchar(40)
    CHECK (refund_reason IN ('DRIVER_CANCELLED','PASSENGER_CANCELLED','DISPUTE','ADMIN','TRIP_CHANGED','LATE_PAYMENT','TRIP_NOT_STARTED','DRIVER_LATE')),
  -- Blocage prolongé une fois pendant un paiement en cours chez le prestataire (doc 05 §4).
  ADD COLUMN hold_extended boolean NOT NULL DEFAULT false;

-- Dernière interrogation du prestataire (limite les appels de GET /payments/:id et de la tâche de rattrapage).
ALTER TABLE payments ADD COLUMN last_polled_at timestamptz;

-- Un seul remboursement automatique actif par réservation et par motif : une tâche rejouée ne rembourse pas deux fois.
-- Les remboursements décidés par le personnel (réclamation, geste commercial) peuvent s'ajouter, dans la limite du payé.
CREATE UNIQUE INDEX refunds_one_active_per_reason ON refunds (booking_id, reason_code)
  WHERE status NOT IN ('REJECTED','FAILED') AND reason_code NOT IN ('DISPUTE','ADMIN');
ALTER TABLE refunds ADD COLUMN succeeded_at timestamptz;

CREATE INDEX bookings_refund_pending_idx ON bookings (updated_at) WHERE payment_status = 'REFUND_PENDING';
CREATE INDEX ledger_entries_booking_idx ON ledger_entries (booking_id);

-- Bac à sable interne : opérations simulées du prestataire « sandbox ». Jamais utilisé en production
-- (le serveur refuse de démarrer avec PAYMENT_PROVIDER=sandbox en production). Aucun argent réel.
CREATE TABLE sandbox_transactions (
  provider_reference varchar(40) PRIMARY KEY,
  kind               varchar(10) NOT NULL CHECK (kind IN ('PAYMENT','REFUND')),
  merchant_reference uuid NOT NULL,           -- payments.id ou refunds.id
  amount_xof         bigint NOT NULL CHECK (amount_xof > 0),
  method             payment_method,
  payer_phone_masked varchar(30),
  status             varchar(12) NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','EXPIRED','CANCELLED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sandbox_transactions_merchant_idx ON sandbox_transactions (merchant_reference);
CREATE INDEX sandbox_transactions_created_idx ON sandbox_transactions (created_at);
CREATE TRIGGER sandbox_transactions_updated_at BEFORE UPDATE ON sandbox_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
