#!/usr/bin/env bash
# Restaure un export logique (dump) dans une NOUVELLE base, sans toucher à la base en service :
#   bash infrastructure/backup/restaurer-export.sh backups/dump/ivoirecovoit-20261029-0200.dump [nom_de_base]
# Pour remplacer la base en service après un incident, suivre docs/sauvegardes.md (arrêt de l'API d'abord).
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=${ENV_FILE:-.env.prod}
# Lecture des seules valeurs utiles (le fichier n'est pas un script shell).
val() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
POSTGRES_USER=$(val POSTGRES_USER)
DUMP=${1:?Indiquer le fichier .dump}
TARGET=${2:-ivoirecovoit_restauree}
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
REL=${DUMP#*backups/}
"${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$TARGET\""
"${COMPOSE[@]}" exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$TARGET" --no-owner --exit-on-error "/backups/$REL"
echo "Export restauré dans la base « $TARGET »."
