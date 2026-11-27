-- 0019 : assistance (conversation entre un membre et l'équipe), hors réservation.
CREATE TYPE support_status AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

CREATE TABLE support_tickets (
  id uuid PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
  topic text NOT NULL DEFAULT 'AUTRE' CHECK (topic IN ('COMPTE', 'RESERVATION', 'PAIEMENT', 'CONDUCTEUR', 'SECURITE', 'AUTRE')),
  status support_status NOT NULL DEFAULT 'OPEN',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, last_message_at DESC);
CREATE INDEX support_tickets_status_idx ON support_tickets (status, last_message_at DESC);

CREATE TABLE support_messages (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  from_staff boolean NOT NULL DEFAULT false,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, id);
CREATE TRIGGER support_tickets_updated_at BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
