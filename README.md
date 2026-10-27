# IvoireCovoit

Plateforme de covoiturage pour la Côte d'Ivoire : application mobile (Flutter, Android en priorité), site web et administration (Next.js), API (NestJS), PostgreSQL + PostGIS. Nom provisoire.

> **État : étape 4 sur 10** (structure du projet et environnements). Voir [docs/etapes/etape-04.md](docs/etapes/etape-04.md) pour ce qui fonctionne, ce qui est simulé et ce qui reste à faire.
> Aucune clé d'API, aucun compte marchand et aucune intégration de paiement réelle ne sont inclus.

## Structure

```
apps/backend         API NestJS, migrations SQL, données de référence et de démonstration
apps/web             Site web et (à venir) administration, Next.js
apps/mobile          Application Flutter (Android / iOS)
infrastructure/      docker compose, préparation OSRM
docs/specifications  Cahier des charges, architecture, schéma, API, règles, plan de tests
docs/adr             Décisions d'architecture
docs/etapes          Rapports d'étape
```

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
pnpm --filter @ivoirecovoit/backend test   # unitaires + intégration sur une vraie base PostGIS (TEST_DATABASE_URL)
pnpm --filter @ivoirecovoit/web test       # Vitest + Testing Library
cd apps/mobile && flutter analyze && flutter test
```

La base de test (`ivoirecovoit_test`) est supprimée et recréée à chaque exécution.

## Sécurité

- Ne jamais commiter `.env` ni aucune clé. La CI recherche les secrets (gitleaks).
- Le serveur refuse de démarrer en production avec le paiement sandbox, l'OTP de test ou une API non HTTPS.
- Les données `[DEMO]` utilisent des numéros fictifs (+225 00 00 00 00 xx) et ne peuvent pas être chargées en production.

## Données cartographiques

Les coordonnées du référentiel de lieux (`apps/backend/src/database/seeds/places-ci.json`) sont **approximatives** et doivent être vérifiées contre OpenStreetMap avant la production. Les distances et durées sont toujours présentées comme des estimations. Données OSM : © contributeurs OpenStreetMap, licence ODbL.
