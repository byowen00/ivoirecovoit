#!/bin/sh
# Copie des sauvegardes hors du serveur (profil « offsite ») : toutes les OFFSITE_EVERY_HOURS heures,
# rclone copie /backups vers RCLONE_DESTINATION (ex. « stockage:ivoirecovoit-sauvegardes »), défini dans
# infrastructure/rclone/rclone.conf (jamais versionné). « copy » n'efface rien à destination : la durée de
# conservation y est réglée côté stockage (règle de cycle de vie).
set -u
: "${RCLONE_DESTINATION:?Définir RCLONE_DESTINATION}"
while true; do
  if rclone copy /backups "$RCLONE_DESTINATION" --exclude '*.part/**' --exclude '*.part' --transfers 2; then
    echo "$(date -u +%FT%TZ) copie hors serveur terminée"
  else
    echo "$(date -u +%FT%TZ) ÉCHEC de la copie hors serveur"
  fi
  sleep $(( ${OFFSITE_EVERY_HOURS:-6} * 3600 ))
done
