#!/bin/sh
# Une sauvegarde complète d'IvoireCovoit (lancée chaque nuit par backup-loop.sh, ou à la main :
#   docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env.prod \
#     exec backup sh /scripts/backup-once.sh
# Produit dans /backups :
#   base/AAAAMMJJ-HHMM/  copie physique (pg_basebackup) : point de départ d'une restauration à un instant donné,
#                        avec les journaux archivés en continu dans wal/ par PostgreSQL
#   dump/ivoirecovoit-AAAAMMJJ-HHMM.dump  export logique (pg_dump), plus simple à restaurer en entier
#   SHA256SUMS, derniere-sauvegarde.txt
# Puis supprime ce qui a plus de BACKUP_RETENTION_DAYS jours (7 par défaut), en gardant toujours la plus récente.
set -eu
STAMP=$(date -u +%Y%m%d-%H%M)
RETENTION=${BACKUP_RETENTION_DAYS:-7}
umask 077
mkdir -p /backups/base /backups/dump

echo "[$(date -u +%FT%TZ)] Sauvegarde $STAMP : copie de base"
pg_basebackup -D "/backups/base/$STAMP.part" -Ft -z -Xs --checkpoint=fast --label "ivoirecovoit-$STAMP"
mv "/backups/base/$STAMP.part" "/backups/base/$STAMP"

echo "[$(date -u +%FT%TZ)] Export logique"
pg_dump -Fc -f "/backups/dump/ivoirecovoit-$STAMP.dump.part"
# Vérifie que l'export est lisible avant de le garder.
pg_restore --list "/backups/dump/ivoirecovoit-$STAMP.dump.part" > /dev/null
mv "/backups/dump/ivoirecovoit-$STAMP.dump.part" "/backups/dump/ivoirecovoit-$STAMP.dump"

echo "[$(date -u +%FT%TZ)] Rotation ($RETENTION jours)"
find /backups/dump -name 'ivoirecovoit-*.dump' -mtime +"$RETENTION" ! -name "ivoirecovoit-$STAMP.dump" -delete
find /backups/base -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION" ! -name "$STAMP" -exec rm -rf {} +
# Journaux plus anciens que la plus ancienne copie de base gardée : inutiles pour une restauration.
OLDEST=$(ls -1d /backups/base/*/ 2>/dev/null | grep -v '\.part/$' | sort | head -n 1)
if [ -n "$OLDEST" ]; then
  find /backups/wal -type f ! -newer "$OLDEST/base.tar.gz" -delete
fi
find /backups -name '*.part' -mmin +720 -exec rm -rf {} + 2>/dev/null || true

(cd /backups && find dump base -type f | sort | xargs sha256sum > SHA256SUMS)
echo "$STAMP $(du -sh /backups | cut -f1)" > /backups/derniere-sauvegarde.txt
echo "[$(date -u +%FT%TZ)] Sauvegarde $STAMP terminée ($(du -sh /backups | cut -f1) au total)"
