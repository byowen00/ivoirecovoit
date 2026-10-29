#!/usr/bin/env bash
# Génère les secrets d'un déploiement (à copier dans infrastructure/.env.prod, jamais dans le dépôt) :
#   bash infrastructure/generer-secrets.sh >> infrastructure/.env.prod
# Chaque exécution produit des valeurs nouvelles : ne pas relancer sur un serveur en service (les sessions,
# les codes TOTP du personnel et les numéros de permis chiffrés deviendraient illisibles).
set -euo pipefail
hex() { openssl rand -hex "$1"; }
echo "# --- Secrets générés le $(date -u +%F) ---"
echo "POSTGRES_PASSWORD=$(hex 24)"
echo "REDIS_PASSWORD=$(hex 24)"
echo "OTP_HMAC_SECRET=$(hex 32)"
echo "REFRESH_TOKEN_PEPPER=$(hex 32)"
echo "STAFF_TOTP_ENCRYPTION_KEY=$(hex 32)"
echo "PII_ENCRYPTION_KEY=$(hex 32)"
echo "SANDBOX_WEBHOOK_SECRET=$(hex 32)"
echo "S3_SECRET_KEY=$(hex 24)"
# Paire Ed25519 des jetons d'accès, sur une ligne (\n), comme pnpm --filter @ivoirecovoit/backend keys:generate.
KEY=$(openssl genpkey -algorithm ed25519)
oneline() { awk 'BEGIN { ORS = "\\n" } { print }' | sed 's/\\n$//'; }
echo "JWT_PRIVATE_KEY=\"$(printf '%s\n' "$KEY" | oneline)\""
echo "JWT_PUBLIC_KEY=\"$(printf '%s\n' "$KEY" | openssl pkey -pubout | oneline)\""
