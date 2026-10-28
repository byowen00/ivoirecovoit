# Étape 4 : structure du projet et environnements de développement

Date : 27 octobre 2026. Statut : **terminée**, à valider.

## 1. Fonctionnalités terminées

| Domaine | Ce qui fonctionne réellement |
|---|---|
| Monorepo | pnpm workspaces (`apps/backend`, `apps/web`), Flutter autonome dans `apps/mobile` |
| Base de données | 11 migrations SQL appliquées sur PostgreSQL 16 + PostGIS 3.4 : les 18 tables demandées et les tables techniques (sessions, idempotence, outbox, grand livre, rapprochement, paramètres…) |
| Intégrité en base | Montants cohérents (`total = sous-total + frais − remise`, `net = sous-total − commission`), arrêts appartenant au trajet réservé, une seule réservation active par passager et par trajet, transitions de statut contrôlées (réservations, paiements), un seul paiement réussi et un seul en cours par réservation, remboursements plafonnés au montant payé, grand livre équilibré, journal d'audit non modifiable, véhicule interdit sur deux trajets simultanés, prix multiples de 50 XOF |
| Exécuteur de migrations | Une transaction par fichier, verrou contre les exécutions concurrentes, refus d'une migration modifiée après application |
| Données | Référentiel : 50 lieux (32 villes, 11 communes d'Abidjan, 7 quartiers/gares), 3 politiques d'annulation, 4 rôles du personnel, paramètres par défaut. Démo : 7 utilisateurs `[DEMO]`, 4 véhicules, 6 trajets (Abidjan–Yamoussoukro, –Bouaké, –Daloa, –San-Pédro, –Grand-Bassam, Abobo–Plateau) |
| API NestJS | `GET /api/v1/health`, `GET /api/v1/places/autocomplete` (tolérant aux accents et fautes : « yamoussokro », « bassam », « BOUAKE »), format d'erreur standard, identifiant de corrélation, en-têtes de sécurité (helmet), CORS restreint, documentation OpenAPI `/api/docs` hors production |
| Configuration | Validation au démarrage ; **refus de démarrer en production** avec le paiement sandbox, l'OTP de test ou une API non HTTPS ; données de démo refusées en production |
| Web Next.js | Écran d'accueil avec saisie assistée des lieux (clavier, lecteur d'écran, états chargement/erreur/vide, nouvelles tentatives réseau), page « État du service », bandeau « environnement de développement », jetons du système de design (couleurs contrastées AA, mode sombre préparé) |
| Mobile Flutter | Écran d'accueil avec saisie assistée des lieux, sélection de date en français, nombre de places, écran « État du service », client HTTP avec délai d'attente et nouvelles tentatives, thème aligné sur le web |
| Docker | Images backend et web construites et lancées avec succès ; `docker compose` (PostGIS, Redis) démarré, migrations et données chargées par les scripts `pnpm` |
| CI | GitHub Actions : lint, types, tests (avec PostGIS), builds web, analyse + tests + **build APK Android**, images Docker, recherche de secrets |

## 2. Ce qui est simulé, partiel ou non vérifié

| Élément | État |
|---|---|
| Bouton « Rechercher » | Désactivé et signalé : la recherche de trajets est l'étape 6 |
| Coordonnées des lieux | **Approximatives**, saisies à la main (l'accès à OpenStreetMap/Nominatim est bloqué dans cet environnement). Marquées `APPROX` en base, à vérifier avant production |
| Distances et durées des trajets de démo | Estimation de repli (vol d'oiseau × 1,3, 70 km/h interurbain, 25 km/h urbain), marquée `HAVERSINE_FALLBACK`. OSRM sera branché à l'étape 6 |
| Build APK Android | Réussi dans la CI GitHub le 28/10/2026 (APK de debug téléchargeable 7 jours dans l'onglet Actions). Non testé sur un téléphone réel |
| Build iOS | Non exécuté (nécessite un Mac) |
| MinIO et OSRM | Déclarés dans `docker compose` (profils `storage` et `routing`) mais **non démarrés ici** (images non téléchargeables dans cet environnement). Utilisés à partir de l'étape 6 |
| Workflow CI | Première exécution le 28/10/2026 : les 5 tâches réussies (backend, web, mobile + APK, images Docker, recherche de secrets) |
| Maquettes | Jetons de couleur, typographie, champs, boutons et deux écrans réels. Les autres écrans seront construits directement, fonctionnels, à chaque étape plutôt qu'en maquettes statiques |

## 3. Écarts par rapport aux documents validés

- **Kysely + migrations SQL** au lieu de Prisma (voir `docs/adr/0001-kysely-et-migrations-sql.md`).
- **NestJS 11 et Kysely 0.28** figés : les versions suivantes sont uniquement ESM et cassent les tests (ADR 0002).
- `trips.estimated_arrival_at` ajouté : nécessaire à la contrainte « un véhicule, un trajet à la fois ».
- `fee_rules.trip_kind_key` (colonne générée) : nécessaire pour interdire le chevauchement de deux grilles tarifaires.
- Les documents de `docs/specifications` ont été mis à jour en conséquence.

## 4. Commandes exécutées (extrait)

```bash
pnpm install
pnpm --filter @ivoirecovoit/backend db:migrate            # 11 migrations appliquées
pnpm --filter @ivoirecovoit/backend db:seed               # 50 lieux, rejoué 2 fois (idempotent)
pnpm --filter @ivoirecovoit/backend db:seed:demo          # 7 utilisateurs, 4 véhicules, 6 trajets ; 2e passage ignoré
pnpm --filter @ivoirecovoit/backend test                  # Jest
pnpm --filter @ivoirecovoit/backend lint / typecheck / build
pnpm --filter @ivoirecovoit/web lint / typecheck / test / build
flutter analyze && flutter test                          # dans apps/mobile
docker build -f apps/backend/Dockerfile .                 # puis migrate, seed, health dans le conteneur
docker build -f apps/web/Dockerfile .                     # puis accueil et relais /api/v1 dans le conteneur
docker compose -f infrastructure/docker-compose.yml up -d --wait   # PostGIS + Redis, puis migrate/seed
```

## 5. Résultats des tests réellement obtenus

| Suite | Résultat |
|---|---|
| Backend (Jest, base PostGIS réelle) | **33 / 33** réussis, 6 suites |
| Web (Vitest + Testing Library) | **7 / 7** réussis |
| Mobile (flutter test) | **8 / 8** réussis |
| Lint et types | backend, web : aucune erreur ; `flutter analyze` : aucun problème |
| Builds | backend `tsc`, web `next build`, images Docker backend et web : réussis |

Détail des tests d'intégrité de la base : réservation cohérente et historique automatique, total incohérent refusé, arrêt d'un autre trajet refusé, double réservation active refusée, transitions interdites refusées (`PENDING_PAYMENT → COMPLETED`, `CONFIRMED → PENDING_PAYMENT`), chevauchement de véhicule refusé, un seul paiement en cours, succès de paiement irréversible, remboursements plafonnés, grand livre déséquilibré refusé, audit non modifiable, prix non multiple de 50 refusé, migrations idempotentes et protégées contre la modification.

Une anomalie a été trouvée et corrigée grâce à une capture d'écran : après le choix d'un lieu, le message « Aucun lieu trouvé » restait affiché. Un test couvre désormais ce cas (web et mobile).

## 6. Problèmes encore présents

- Les coordonnées des lieux doivent être vérifiées.
- L'APK n'a pas encore été essayé sur un téléphone réel.

## 7. Prochaine étape

**Étape 5 : authentification, rôles et profils** : OTP (mode test en développement), sessions et jetons rotatifs, limitation des tentatives, rôles et permissions côté serveur, comptes du personnel avec double authentification, profil et consentements, journal d'audit ; écrans bienvenue, inscription/connexion, vérification du téléphone, profil et paramètres.
