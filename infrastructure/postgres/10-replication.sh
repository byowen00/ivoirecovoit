#!/bin/sh
# Exécuté une seule fois, à la création de la base : autorise la copie de base (pg_basebackup) depuis le
# conteneur de sauvegarde, sur le réseau interne de Docker uniquement (le port 5432 n'est pas publié).
set -e
echo "host replication ${POSTGRES_USER} samenet scram-sha-256" >> "$PGDATA/pg_hba.conf"
