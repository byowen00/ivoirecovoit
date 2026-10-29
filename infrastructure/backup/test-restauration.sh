#!/usr/bin/env bash
# Test de restauration (ENF-04, à faire chaque mois) : restaure la dernière copie de base et les journaux dans
# un conteneur JETABLE, sans toucher à la production, puis compare le nombre de lignes des tables principales
# avec la base en service. À lancer sur le serveur, depuis la racine du dépôt :
#   bash infrastructure/backup/test-restauration.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=${ENV_FILE:-.env.prod}
# Lecture des seules valeurs utiles (le fichier n'est pas un script shell).
val() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
POSTGRES_USER=$(val POSTGRES_USER)
POSTGRES_DB=$(val POSTGRES_DB)
BACKUP_DIR=$(val BACKUP_DIR)
BACKUP_DIR=$(cd "${BACKUP_DIR:-./backups}" && pwd)
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
BASE=$(ls -1d "$BACKUP_DIR"/base/*/ | grep -v '\.part/$' | sort | tail -n 1)
BASE=${BASE%/}
NAME=ivoirecovoit-test-restauration
echo "Copie de base : $(basename "$BASE")"

# Force l'archivage du journal en cours pour que la copie restaurée soit à jour.
"${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAtc "SELECT pg_switch_wal()" > /dev/null
sleep 3

docker rm -f "$NAME" > /dev/null 2>&1 || true
trap 'docker rm -fv "$NAME" > /dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -v "$BACKUP_DIR:/backups:ro" -v "$PWD/backup:/scripts:ro" --entrypoint sh \
  postgis/postgis:16-3.4 -c "sh /scripts/prepare-pitr.sh '/backups/base/$(basename "$BASE")' && exec gosu postgres postgres -c archive_mode=off" > /dev/null
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U "$POSTGRES_USER" -q 2>/dev/null \
     && [ "$(docker exec "$NAME" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAtc 'SELECT pg_is_in_recovery()' 2>/dev/null)" = "f" ]; then
    break
  fi
  sleep 2
done

TABLES="users trips trip_stops bookings payments refunds ledger_entries audit_logs"
SQL="SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (VALUES $(for t in $TABLES; do printf "('%s',(SELECT count(*) FROM %s))," "$t" "$t"; done | sed 's/,$//')) v(t, n)"
LIVE=$("${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAtc "$SQL")
RESTORED=$(docker exec "$NAME" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAtc "$SQL")
echo "En service : $LIVE"
echo "Restaurée  : $RESTORED"
if [ "$LIVE" = "$RESTORED" ]; then
  echo "RÉSULTAT : restauration réussie, mêmes nombres de lignes."
else
  echo "RÉSULTAT : écart (normal seulement si des écritures ont eu lieu pendant le test). À examiner." >&2
  exit 1
fi
