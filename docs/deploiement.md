# Guide de déploiement

Ce guide installe IvoireCovoit sur **un serveur Linux** avec Docker : site web et console d'administration, API,
PostgreSQL/PostGIS, Redis, sauvegardes, et Caddy pour le HTTPS. Fichiers utilisés :
`infrastructure/docker-compose.prod.yml`, `infrastructure/caddy/Caddyfile`, `infrastructure/.env.prod.example`.

> **État au 29 octobre 2026.** L'API refuse de démarrer avec `NODE_ENV=production` tant que deux intégrations
> manquent : un fournisseur SMS (codes de connexion) et un agrégateur de paiement réel. Ce guide permet donc
> aujourd'hui une **pré-production** (`NODE_ENV=staging`) : codes de connexion affichés à l'écran, paiements
> simulés, bandeau « Pré-production » sur le site. À n'utiliser qu'avec des données de test. La liste de ce
> qu'il faut obtenir avant la production est dans [avant-production.md](avant-production.md).

## 1. Serveur

| | Pré-production | Lancement (estimation à confirmer par la charge réelle) |
|---|---|---|
| Processeur, mémoire | 2 vCPU, 4 Go | 4 vCPU, 8 Go |
| Disque | 40 Go SSD | 80 Go SSD + stockage S3 externe pour les documents |
| Système | Ubuntu 24.04 LTS ou Debian 12 | idem |

Mesure de référence (étape 10, une seule machine de 4 vCPU qui faisait tourner l'API, la base et l'outil de
test) : 290 recherches par seconde au maximum sur 50 000 trajets, 26 ms au 95ᵉ centile à 47 recherches/s.

Choisir un hébergeur proche des utilisateurs réduit la latence (Afrique de l'Ouest, ou Europe à défaut) et
vérifier les obligations de localisation des données personnelles auprès de l'ARTCI.

## 2. Préparer le serveur (une fois)

```bash
# Docker Engine et le plugin Compose (dépôt officiel Docker)
curl -fsSL https://get.docker.com | sh
# Pare-feu : SSH, HTTP, HTTPS seulement
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
# Mises à jour de sécurité automatiques
apt-get install -y unattended-upgrades
# Utilisateur de déploiement, connexion SSH par clé uniquement (PasswordAuthentication no dans sshd_config)
adduser --disabled-password deploy && usermod -aG docker deploy
```

DNS : créer les enregistrements A (et AAAA si IPv6) vers l'adresse du serveur pour `WEB_DOMAIN`, `API_DOMAIN` et,
si les documents sont stockés sur ce serveur, `FILES_DOMAIN`. Caddy ne peut obtenir les certificats qu'une fois
ces noms résolus.

## 3. Installer

```bash
git clone https://github.com/byowen00/ivoirecovoit.git && cd ivoirecovoit
cp infrastructure/.env.prod.example infrastructure/.env.prod
nano infrastructure/.env.prod                                # domaines, e-mail, mode
bash infrastructure/generer-secrets.sh >> infrastructure/.env.prod   # secrets aléatoires et clés JWT
chmod 600 infrastructure/.env.prod
```

Copier aussitôt le contenu de `.env.prod` dans un coffre de mots de passe : sans ces secrets, les sessions, les
codes TOTP du personnel et les numéros de permis chiffrés sont perdus.

```bash
C="docker compose -f infrastructure/docker-compose.prod.yml --env-file infrastructure/.env.prod"
$C --profile storage up -d --build     # sans « --profile storage » si les documents sont chez un fournisseur S3
$C ps                                  # tous « healthy » ou « running » ; « migrate » terminé avec le code 0
$C run --rm migrate node dist/scripts/init-storage.js       # bucket privé des documents (une fois)
```

La construction des images prend plusieurs minutes et environ 3 Go de mémoire. Sur un petit serveur, construire
plutôt les images ailleurs (CI) et renseigner `BACKEND_IMAGE` / `WEB_IMAGE`.

Premier compte du personnel (le mot de passe est demandé, le lien `otpauth://` à scanner n'est affiché qu'une fois) :

```bash
$C run --rm -it migrate node dist/scripts/create-staff.js --email vous@exemple.ci --first Prénom --last Nom --role SUPER_ADMIN
```

Données de démonstration en pré-production seulement : `$C run --rm migrate node dist/database/seeds/run-seed.js demo`.

## 4. Vérifier

```bash
curl -s https://$API_DOMAIN/api/v1/health      # {"status":"ok","database":"ok","redis":"ok",...}
curl -sI https://$WEB_DOMAIN | grep -i strict-transport-security
```

Puis, dans un navigateur : recherche, connexion (code affiché en pré-production), console `/admin` avec le compte
du personnel, page « État du service ».

## 5. Mettre à jour

```bash
$C exec backup sh /scripts/backup-once.sh        # sauvegarde avant toute mise à jour
git pull
$C up -d --build                                  # les migrations passent avant le redémarrage de l'API
$C logs -f --tail=100 backend
```

Retour arrière : `git checkout <version précédente>` puis `$C up -d --build`. Les migrations ne sont pas annulées
automatiquement : si une migration doit être défaite, restaurer la sauvegarde prise juste avant (voir
[sauvegardes.md](sauvegardes.md)).

## 6. Exploiter

| Sujet | Où regarder |
|---|---|
| Journaux | `$C logs <service>` (JSON, rotation 5 × 10 Mo par service). Caddy masque `Authorization` et `Cookie` |
| Santé | `/api/v1/health` ; page « État du service » du site ; `$C ps` |
| Sauvegardes | `infrastructure/backups/derniere-sauvegarde.txt`, absence de `ECHEC.txt` ; test mensuel |
| Certificats | renouvelés par Caddy ; Let's Encrypt écrit à `ACME_EMAIL` en cas de problème |
| Paiements | console, Finance → rapprochement (chaque nuit) : traiter tout écart |

Surveillance externe recommandée (non fournie) : une sonde HTTP sur `/api/v1/health` toutes les minutes avec
alerte par SMS ou e-mail, et une alerte sur l'espace disque.

## 7. Sécurité

- Seuls les ports 80 et 443 sont ouverts ; PostgreSQL, Redis et le stockage ne sont joignables que sur le réseau
  interne de Docker. Redis exige un mot de passe.
- La documentation de l'API (`/api/docs`) n'est jamais servie publiquement.
- En-têtes posés par Caddy et les applications : HSTS, CSP à nonce sur le site, `X-Frame-Options`,
  `nosniff`, `Cache-Control: no-store` sur l'API.
- Pré-production accessible sur Internet : restreindre l'accès (mot de passe ou adresses IP) avec un fichier
  dans `infrastructure/caddy/acces.d/` (voir le `README.md` de ce dossier). Les codes de connexion de test
  permettent à n'importe qui de se connecter avec n'importe quel numéro (le code est affiché).
- Les conteneurs de l'API et du site tournent avec un système de fichiers en lecture seule.
