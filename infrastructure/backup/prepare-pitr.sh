#!/bin/sh
# Prépare un répertoire de données PostgreSQL VIDE pour une restauration à un instant donné.
# À lancer dans un conteneur postgis/postgis:16-3.4 qui voit /backups, avant de démarrer PostgreSQL :
#   prepare-pitr.sh <copie de base, ex. /backups/base/20261029-0200> ["2026-10-29 14:30:00+00"]
# Sans heure : rejoue tous les journaux disponibles (état le plus récent possible).
set -eu
BASE=${1:?Indiquer le répertoire de la copie de base}
TARGET=${2:-}
DATA=${PGDATA:-/var/lib/postgresql/data}
if [ -n "$(ls -A "$DATA" 2>/dev/null)" ]; then
  echo "Le répertoire $DATA n'est pas vide : restauration refusée (rien n'est écrasé)." >&2
  exit 1
fi
mkdir -p "$DATA"
tar -xzf "$BASE/base.tar.gz" -C "$DATA"
mkdir -p "$DATA/pg_wal"
tar -xzf "$BASE/pg_wal.tar.gz" -C "$DATA/pg_wal"
{
  echo "restore_command = 'cp /backups/wal/%f %p'"
  [ -n "$TARGET" ] && echo "recovery_target_time = '$TARGET'"
  echo "recovery_target_action = 'promote'"
} >> "$DATA/postgresql.auto.conf"
# Pas d'archivage depuis la copie restaurée (elle ne doit pas écrire dans le dossier des vraies sauvegardes).
echo "archive_mode = 'off'" >> "$DATA/postgresql.auto.conf"
touch "$DATA/recovery.signal"
chown -R postgres:postgres "$DATA"
chmod 700 "$DATA"
echo "Prêt : démarrer PostgreSQL sur $DATA ; il rejouera les journaux puis s'ouvrira en écriture."
