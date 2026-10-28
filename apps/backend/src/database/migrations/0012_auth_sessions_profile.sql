-- 0012 : authentification (étape 5)

-- Un compte est créé dès la vérification du téléphone ; le prénom et le nom sont demandés juste après.
-- Tant qu'ils manquent, le compte reste PENDING_VERIFICATION et ne peut rien réserver ni publier.
ALTER TABLE users ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE users ALTER COLUMN last_name DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_active_has_name
  CHECK (status <> 'ACTIVE' OR (first_name IS NOT NULL AND last_name IS NOT NULL));

-- Sessions des utilisateurs et du personnel séparées : un jeton utilisateur n'ouvre jamais l'administration.
ALTER TABLE sessions ADD COLUMN kind varchar(10) NOT NULL DEFAULT 'USER' CHECK (kind IN ('USER','STAFF'));
ALTER TABLE sessions ADD COLUMN revoked_reason varchar(30)
  CHECK (revoked_reason IN ('ROTATED','LOGOUT','LOGOUT_ALL','REVOKED_BY_USER','REUSE_DETECTED','ACCOUNT_SUSPENDED','ACCOUNT_DELETED'));
ALTER TABLE sessions ADD CONSTRAINT sessions_revocation_consistent
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL));

-- Anti-rejeu TOTP : un même code (pas de 30 s) ne peut servir qu'une fois.
ALTER TABLE staff_accounts ADD COLUMN totp_last_step bigint;
ALTER TABLE staff_accounts ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
