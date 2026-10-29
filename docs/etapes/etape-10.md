# Étape 10 : tests, corrections, déploiement

Date : 29 octobre 2026. Statut : **terminée**, à valider.

La plateforme est prête pour une **pré-production** : paiement uniquement dans le **bac à sable interne**, codes de connexion de test, données marquées. La production reste impossible tant qu'il manque un fournisseur SMS et un agrégateur de paiement : l'API refuse de démarrer avec `NODE_ENV=production` dans ce cas. Aucune clé, aucun compte marchand, aucune certification et aucune intégration réelle ne sont inclus ni déclarés opérationnels. Les coûts sont des **estimations** avec leurs sources.

## 1. Fonctionnalités terminées

| Domaine | Ce qui fonctionne réellement |
|---|---|
| Campagne de tests | Toutes les suites relancées (backend, web, mobile), lint, types, `pnpm audit` ; la CI vérifie maintenant les dépendances de production (`pnpm audit --prod --audit-level high`) |
| Tests de charge (k6, `tests/charge/`) | Jeu de 50 000 trajets marqués `[CHARGE]` (2 000 conducteurs), scénario de recherche jusqu'à 100 utilisateurs simultanés, scénario de rush sur les dernières places |
| Performance de la recherche | Migration `0017` (deux index sur les arrêts) et préfiltre spatial dans la requête : p95 sans temps de réflexion passé de 845 ms à 341 ms |
| Sécurité (ZAP) | Analyse passive du site et analyse active de l'API (138 routes) ; corrections : politique CSP à **nonce** par requête (`apps/web/proxy.ts`), cookies effacés avec les mêmes attributs, `Cache-Control: no-store` sur l'API, `/api/docs` fermé derrière Caddy |
| Production (`infrastructure/docker-compose.prod.yml`) | Caddy (HTTPS automatique, HTTP/2 et 3, HSTS, compression, journal JSON), site, API, migrations au démarrage, PostgreSQL/PostGIS avec archivage des WAL, Redis avec mot de passe, sauvegardes ; profils optionnels stockage (RustFS), itinéraires (OSRM), copie hors site (rclone). Conteneurs en lecture seule, journaux limités. `generer-secrets.sh` crée tous les secrets et la paire de clés JWT |
| Accès restreint en pré-production | `infrastructure/caddy/acces.d/` : exemple de mot de passe sur tout le site (sauf les webhooks) ou de filtrage par adresse IP |
| Sauvegardes | Sauvegarde physique quotidienne + archivage continu des WAL (restauration à la minute près) + export logique vérifié, empreintes SHA-256, rotation, fichier d'échec ; script de **test de restauration** automatique ; restauration d'un export dans une base séparée |
| APK Android | La CI construit un APK « release » **signé** (clé de test jetable sans les secrets `ANDROID_KEYSTORE_*`), un par architecture, vérifie la signature et la taille (< 25 Mo) et le publie en artefact `ivoirecovoit-apk-test-signe` |
| Documentation | `docs/installation-linux.md`, `docs/installation-windows.md`, `docs/deploiement.md`, `docs/sauvegardes.md`, `docs/apk-android.md`, `docs/couts-recurrents.md`, `docs/avant-production.md`, `tests/charge/README.md` ; README mis à jour |
| Corrections | En-tête public masqué sur la console `/admin` (problème de l'étape 9) ; bandeau « Pré-production : données de test, aucun paiement réel » ; doublon FCM retiré de `.env.example` ; dépendances vulnérables corrigées (`multer`, `js-yaml`) |

## 2. Ce qui est simulé, partiel ou non vérifié

| Élément | État |
|---|---|
| Paiement et SMS | Toujours bac à sable et codes de test. Aucun prestataire intégré |
| Copie hors site (rclone) | Écrite et documentée, **pas essayée** : l'image n'a pas pu être téléchargée ici (limite de Docker Hub) |
| Certificat TLS public | Essayé avec le certificat interne de Caddy sur `*.localhost` ; Let's Encrypt demande un vrai nom de domaine |
| APK | Construit et vérifié **uniquement dans la CI** (Google bloqué dans cet environnement) ; **jamais installé sur un vrai téléphone** |
| Tests de charge | Sur une machine de 4 vCPU partagée par k6, l'API et PostgreSQL : les chiffres sont prudents mais ne remplacent pas un essai sur le vrai serveur |
| Coûts | Estimations à partir de pages publiques (citées), à confirmer par devis ; frais Mobile Money tirés d'un comparatif, pas d'une grille officielle |
| Notifications FCM, OSRM réel, tuiles sous contrat | Inchangés depuis l'étape 9 : non branchés |

## 3. Écarts par rapport aux documents validés

- Migration `0017` : index `trip_stops (planned_at) WHERE is_pickup` et `trip_stops (place_id)`.
- La CSP du site est produite à chaque requête (nonce) au lieu d'être fixe dans `next.config.ts`, pour retirer `unsafe-inline` des scripts.
- Le déploiement livré est une **pré-production** (`NODE_ENV=staging`) et non une production : c'est voulu, la production étant bloquée par les éléments de `docs/avant-production.md`.
- L'APK de test est découpé par architecture : l'APK universel mesure 63,5 Mo, au-delà de la limite de 25 Mo d'ENF-02. Sur le Play Store, l'App Bundle fait ce découpage.

## 4. Commandes exécutées (extrait)

```bash
pnpm --filter @ivoirecovoit/backend lint / typecheck / test
pnpm --filter @ivoirecovoit/web lint / typecheck / test / build
flutter analyze && flutter test                                    # apps/mobile
pnpm audit --prod
psql ivoirecovoit_load -f tests/charge/seed-charge.sql
k6 run tests/charge/recherche.js        # avec et sans THINK
k6 run tests/charge/reservations.js
zap-baseline.py -t https://ivoirecovoit.localhost                   # 4 passages
zap-api-scan.py -t openapi.json -f openapi                          # analyse active de l'API
infrastructure/generer-secrets.sh
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile storage up -d
docker compose ... exec backup sh /scripts/backup-once.sh
infrastructure/backup/test-restauration.sh
infrastructure/backup/restaurer-export.sh
```

## 5. Résultats des tests réellement obtenus

| Suite | Résultat |
|---|---|
| Backend (Jest, PostGIS, Redis, S3 réels) | **364 / 364** réussis, 27 fichiers ; lint et types sans erreur |
| Web (Vitest) | **74 / 74** réussis, 14 fichiers (dont CSP et effacement des cookies) ; `next build` réussi |
| Mobile | **54 / 54** ; `flutter analyze` : aucun problème |
| `pnpm audit --prod` | Aucune vulnérabilité connue. Reste une faille « faible » (`deepmerge`) dans les outils de test seulement, sans version corrigée |
| Recherche, 100 utilisateurs, temps de réflexion | Avant index : p95 88 ms ; **après : p95 26 ms**, moyenne 14 ms, 0 erreur |
| Recherche, 100 utilisateurs, sans pause | Avant index : p95 845 ms à 114 req/s (seuil de 800 ms dépassé, PostgreSQL saturé) ; **après : p95 341 ms à 291 req/s**, 52 304 requêtes, 0 erreur |
| Rush sur les places | 40 passagers sur 5 trajets de 3 places, 200 tentatives : 15 réservations créées, 185 refus « plus de place » (409), 0 réponse inattendue, p95 349 ms. Vérifié en base : chaque trajet a exactement 3 places réservées et passe « complet » (pas de surréservation) |
| ZAP, site (passage final) | **0 échec**, 3 avertissements, 59 contrôles réussis. Avertissements restants : cookie anti-CSRF lisible par le script (voulu, principe du double envoi) ; deux informations sans risque (cache, attribut reflété échappé par React) |
| ZAP, API (analyse active) | **0 échec**, 1 avertissement, 113 réussis. L'avertissement « injection SQL » sur `places/autocomplete` est un faux positif : la valeur est passée en paramètre par Kysely |
| Pile de production locale | Démarrée derrière Caddy : HTTPS, HTTP/2, redirection HTTP → HTTPS, HSTS, `/api/docs` en 404 ; migrations 0001 à 0017 et référentiel appliqués. Dans Chromium : le site s'affiche sous la CSP, la carte s'initialise, connexion jusqu'au code, console sans en-tête public |
| Sauvegarde et restauration | Sauvegarde réussie (base de 8 Mo + export). Test de restauration : « **restauration réussie, mêmes nombres de lignes** » ; un compte créé *après* la sauvegarde est retrouvé, donc les WAL sont bien rejoués. Export restauré dans une base séparée (6 trajets) |
| CI GitHub | Commit 11f38e9 : les 5 tâches réussies. Commit c4a6f40 : échec de la tâche mobile, APK universel de 63,5 Mo > 25 Mo. Commit 8d2695e : APK découpés, **19,8 Mo** (armeabi-v7a), **22,0 Mo** (arm64-v8a), **23,5 Mo** (x86_64), mais filtre de la sortie d’apksigner trop strict ; commit 8e80735 : **les 5 tâches réussies**, signature des 3 APK vérifiée, artefact `ivoirecovoit-apk-test-signe` publié |

## 6. Problèmes encore présents

- L'APK n'a jamais été essayé sur un vrai téléphone, ni la pré-production sur un vrai serveur et un vrai domaine.
- La copie hors site des sauvegardes n'a pas été essayée.
- Le jeu de données des lieux reste approximatif (à vérifier contre OpenStreetMap).
- Tout ce qui est listé dans **`docs/avant-production.md`** : fournisseur SMS, agrégateur Mobile Money et versements aux conducteurs, taux de commission et frais, plafond de prix par km, frais en espèces, plafonds de remboursement, CGU et confidentialité relues par un juriste, formalités ARTCI, numéros d'urgence officiels, clés FCM, fournisseur de tuiles, serveur OSRM, clé de signature Android définitive, nom de domaine.

## 7. Prochaine étape

Les dix étapes sont livrées. La suite n'est plus du développement planifié mais :

1. obtenir les éléments bloquants de `docs/avant-production.md` (SMS, paiement, décisions commerciales, juridique) ;
2. installer la pré-production sur un serveur (`docs/deploiement.md`) et essayer l'APK sur des téléphones réels ;
3. développer les adaptateurs SMS et paiement une fois les contrats et clés obtenus, puis passer en production.
