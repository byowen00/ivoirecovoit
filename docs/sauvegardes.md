# Sauvegardes et restauration

Objectif (ENF-04) : sauvegarde quotidienne, restauration possible à n'importe quel instant des 7 derniers jours,
test de restauration chaque mois.

## Ce qui est sauvegardé

| Quoi | Comment | Où |
|---|---|---|
| Base PostgreSQL, en continu | PostgreSQL archive chaque journal de transactions (WAL), au plus tard toutes les 15 min | `backups/wal/` |
| Base PostgreSQL, chaque nuit | copie physique (`pg_basebackup`) | `backups/base/AAAAMMJJ-HHMM/` |
| Base PostgreSQL, chaque nuit | export logique (`pg_dump`), vérifié par `pg_restore --list` | `backups/dump/` |
| Documents (permis, cartes grises…) | **non couverts** par ces scripts : activer la gestion des versions et la réplication chez le fournisseur S3, ou sauvegarder le volume `storagedata` | — |
| Secrets (`infrastructure/.env.prod`) | à garder dans un coffre de mots de passe, **hors du serveur** | — |

Le conteneur `backup` (docker-compose.prod.yml) lance la sauvegarde à `BACKUP_HOUR_UTC` (2 h par défaut) et
supprime ce qui a plus de `BACKUP_RETENTION_DAYS` jours (7). En cas d'échec il réessaie toutes les heures et écrit
`backups/ECHEC.txt` : surveiller ce fichier et `backups/derniere-sauvegarde.txt`.

Les sauvegardes sont sur le même serveur que la base : **une copie hors serveur est indispensable** (panne disque,
serveur perdu). Profil `offsite` : rclone copie `backups/` toutes les 6 heures vers un stockage externe.

```bash
mkdir -p infrastructure/rclone   # rclone.conf : créé avec « rclone config », jamais versionné
# dans .env.prod : RCLONE_DESTINATION=b2:ivoirecovoit-sauvegardes
docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env.prod --profile offsite up -d offsite
```

## Commandes

```bash
C="docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env.prod"
$C exec backup sh /scripts/backup-once.sh            # sauvegarde immédiate (avant une mise à jour, par exemple)
bash infrastructure/backup/test-restauration.sh      # test mensuel, sans toucher à la production
bash infrastructure/backup/restaurer-export.sh backups/dump/ivoirecovoit-AAAAMMJJ-HHMM.dump essai   # dans une nouvelle base
```

`test-restauration.sh` restaure la dernière copie de base et rejoue les journaux dans un conteneur jetable, puis
compare le nombre de lignes des tables principales avec la base en service.

## Restaurer la production après un incident

1. Prévenir les utilisateurs, arrêter l'API et le site : `$C stop backend web caddy`.
2. Garder l'état actuel pour analyse : `docker run --rm -v ivoirecovoit-prod_pgdata:/d -v "$PWD/infrastructure/backups:/b" alpine tar czf /b/incident-$(date +%F).tar.gz -C /d .`
3. **Restauration complète au dernier export** (le plus simple) :
   `$C exec postgres dropdb -U ivoirecovoit ivoirecovoit && $C exec postgres createdb -U ivoirecovoit ivoirecovoit`
   puis `$C exec postgres pg_restore -U ivoirecovoit -d ivoirecovoit --no-owner /backups/dump/<fichier>.dump`.
4. **Restauration à un instant précis** (ex. juste avant une suppression accidentelle) :
   ```bash
   $C stop postgres
   docker volume rm ivoirecovoit-prod_pgdata         # après l'étape 2 !
   docker run --rm -v ivoirecovoit-prod_pgdata:/var/lib/postgresql/data -v "$PWD/infrastructure/backups:/backups" \
     -v "$PWD/infrastructure/backup:/scripts:ro" postgis/postgis:16-3.4 \
     sh /scripts/prepare-pitr.sh /backups/base/<copie> "2026-10-29 14:30:00+00"
   $C up -d postgres        # rejoue les journaux jusqu'à l'heure demandée puis ouvre la base
   ```
   Retirer ensuite les lignes `restore_command`, `recovery_target_*` et `archive_mode = 'off'` de
   `postgresql.auto.conf` (dans le volume) et redémarrer PostgreSQL pour réactiver l'archivage.
5. Relancer : `$C up -d`, vérifier `/api/v1/health`, puis le rapprochement des paiements (console, Finance) pour
   la période perdue : un paiement confirmé par le prestataire après l'heure restaurée doit être retrouvé.
6. Faire immédiatement une nouvelle sauvegarde complète.

## Base créée avant l'étape 10

La copie de base a besoin d'une autorisation de réplication ajoutée à la création de la base
(`infrastructure/postgres/10-replication.sh`). Pour une base existante :

```bash
$C exec postgres sh -c 'echo "host replication $POSTGRES_USER samenet scram-sha-256" >> "$PGDATA/pg_hba.conf"'
$C exec postgres psql -U ivoirecovoit -c "SELECT pg_reload_conf()"
```
