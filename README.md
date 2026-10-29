# IvoireCovoit

Plateforme de covoiturage pour la Côte d'Ivoire : application mobile (Flutter, Android en priorité), site web et administration (Next.js), API (NestJS), PostgreSQL + PostGIS. Nom provisoire.

> **État : étape 10 sur 10, prêt pour une pré-production** (paiement en bac à sable uniquement, codes de connexion de test). La production attend un fournisseur SMS, un agrégateur de paiement et les décisions listées dans [docs/avant-production.md](docs/avant-production.md). Rapport : [docs/etapes/etape-10.md](docs/etapes/etape-10.md).
> Aucune clé d'API, aucun compte marchand et aucune intégration de paiement réelle ne sont inclus.

## Structure

```
apps/backend         API NestJS, migrations SQL, données de référence et de démonstration
apps/web             Site web et console d'administration (/admin), Next.js
apps/mobile          Application Flutter (Android / iOS)
infrastructure/      docker compose (développement et production), Caddy, sauvegardes, OSRM
tests/charge         Tests de charge k6
docs/specifications  Cahier des charges, architecture, schéma, API, règles, plan de tests
docs/adr             Décisions d'architecture
docs/etapes          Rapports d'étape
docs/*.md            Installation (Linux, Windows), déploiement, sauvegardes, APK, coûts, avant production
```

## Documentation d'exploitation

| Guide | Pour |
|---|---|
| [installation-linux.md](docs/installation-linux.md), [installation-windows.md](docs/installation-windows.md) | poste de développement |
| [deploiement.md](docs/deploiement.md) | serveur (pré-production aujourd'hui) |
| [sauvegardes.md](docs/sauvegardes.md) | sauvegardes, test de restauration, reprise après incident |
| [apk-android.md](docs/apk-android.md) | APK de test signé, clé de publication |
| [couts-recurrents.md](docs/couts-recurrents.md) | estimation des coûts |
| [avant-production.md](docs/avant-production.md) | ce qu'il faut obtenir et décider avant d'ouvrir |

## Prérequis

| Outil | Version | Rôle |
|---|---|---|
| Node.js | 22 LTS | backend et web |
| pnpm | 10 (`corepack enable`) | gestion du monorepo |
| Docker + Docker Compose | récents | PostgreSQL/PostGIS, Redis |
| Flutter | 3.47 stable | application mobile |
| Android Studio ou SDK Android | récent | build et émulateur Android |

## Démarrage rapide (Linux, macOS, Windows avec PowerShell ou WSL 2)

```bash
# 1. Variables d'environnement (valeurs locales, aucun secret réel)
cp .env.example .env            # Windows PowerShell : Copy-Item .env.example .env

# 2. Base de données et Redis
docker compose -f infrastructure/docker-compose.yml --env-file .env up -d --wait

# 3. Dépendances, schéma et données
corepack enable
pnpm install
pnpm db:migrate        # applique les migrations SQL
pnpm db:seed           # référentiel : lieux, politiques d'annulation, rôles, paramètres
pnpm db:seed:demo      # données fictives [DEMO] (refusé en production)

# 4. Lancer l'API (http://localhost:3000/api/v1, documentation : /api/docs)
pnpm dev:backend

# 5. Dans un autre terminal, lancer le site web (http://localhost:3001)
pnpm dev:web
```

### Connexion en développement

Avec `OTP_TEST_MODE=true` (valeur de `.env.example`), aucun SMS n'est envoyé : le code s'affiche dans les logs de l'API
et sur l'écran de saisie du code (encadré « Mode test »). Les numéros `[DEMO]` (+225 00 00 00 00 01 à 13) sont acceptés
dans ce mode uniquement. Aucun fournisseur SMS n'est intégré : la production refuse de démarrer tant qu'il n'y en a pas.

Compte du personnel (mot de passe + code TOTP d'une application d'authentification) :

```bash
pnpm --filter @ivoirecovoit/backend staff:create -- --email vous@exemple.ci --first Prénom --last Nom --role SUPER_ADMIN
# Le mot de passe (12 caractères min.) est demandé ; le lien otpauth:// à scanner n'est affiché qu'une fois.
pnpm --filter @ivoirecovoit/backend keys:generate   # paire Ed25519 pour JWT_PRIVATE_KEY / JWT_PUBLIC_KEY
```

Application mobile :

```bash
cd apps/mobile
flutter pub get
# Émulateur Android : 10.0.2.2 désigne la machine hôte
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
# Téléphone réel sur le même Wi-Fi : remplacer par l'adresse IP locale de l'ordinateur
```

## Tests

```bash
pnpm --filter @ivoirecovoit/backend test   # unitaires + intégration sur PostGIS (TEST_DATABASE_URL), Redis (TEST_REDIS_URL, base 15) et S3 (TEST_S3_ENDPOINT)
pnpm --filter @ivoirecovoit/web test       # Vitest + Testing Library
cd apps/mobile && flutter analyze && flutter test
```

La base de test (`ivoirecovoit_test`) est supprimée et recréée à chaque exécution ; la base Redis 15 est vidée par les tests.

## Sécurité

- Ne jamais commiter `.env` ni aucune clé. La CI recherche les secrets (gitleaks).
- Le serveur refuse de démarrer en production avec le paiement sandbox, l'OTP de test, une API non HTTPS, des secrets de développement, sans clés JWT ou sans fournisseur SMS.
- Le site web ne manipule jamais les jetons : ils restent dans des cookies HttpOnly gérés par le serveur Next.js (`/bff`). L'application mobile garde le refresh token dans le stockage sécurisé d'Android.
- Les données `[DEMO]` utilisent des numéros fictifs (+225 00 00 00 00 xx) et ne peuvent pas être chargées en production.

## Données cartographiques

Les coordonnées du référentiel de lieux (`apps/backend/src/database/seeds/places-ci.json`) sont **approximatives** et doivent être vérifiées contre OpenStreetMap avant la production. Les distances et durées sont toujours présentées comme des estimations.

Itinéraires : sans `OSRM_URL`, l'API calcule une estimation à vol d'oiseau, signalée comme telle à l'écran (voir `infrastructure/osrm` pour préparer OSRM). Fonds de carte : tuiles OpenStreetMap par défaut (`NEXT_PUBLIC_TILE_URL` pour le web, `--dart-define=TILE_URL=…` pour le mobile) ; en production, utiliser un fournisseur de tuiles sous contrat, la politique d'usage d'OSM l'impose.

Pièces justificatives et photos : stockage compatible S3 (RustFS en développement, profil `storage` de docker compose ; voir [ADR 0004](docs/adr/0004-stockage-itineraires-et-recherche.md)). Sans `S3_ENDPOINT`, les dépôts répondent 503 et le reste fonctionne. Données OSM : © contributeurs OpenStreetMap, licence ODbL.
