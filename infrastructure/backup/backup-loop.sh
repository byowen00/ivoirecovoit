#!/bin/sh
# Boucle du conteneur « backup » : une sauvegarde par jour à BACKUP_HOUR_UTC heures (UTC = heure d'Abidjan).
# Un échec est écrit dans les journaux du conteneur et dans /backups/ECHEC.txt (à surveiller), puis on réessaie
# une heure plus tard.
set -u
HOUR=${BACKUP_HOUR_UTC:-2}
echo "Sauvegardes quotidiennes à ${HOUR} h UTC, conservées ${BACKUP_RETENTION_DAYS:-7} jours."
while true; do
  NOW=$(date -u +%s)
  NEXT=$(date -u -d "$(date -u +%F) ${HOUR}:00:00" +%s)
  [ "$NEXT" -le "$NOW" ] && NEXT=$((NEXT + 86400))
  sleep $((NEXT - NOW))
  until sh /scripts/backup-once.sh; do
    echo "$(date -u +%FT%TZ) échec de la sauvegarde" | tee -a /backups/ECHEC.txt
    sleep 3600
  done
  rm -f /backups/ECHEC.txt
done
