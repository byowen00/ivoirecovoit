# IvoireCovoit : étape 3a, architecture générale

> Statut : proposition à valider.

## 1. Vue d'ensemble

```
                    ┌──────────────────────┐      ┌───────────────────────┐
                    │  App mobile Flutter  │      │  Web Next.js (TS)     │
                    │  Android (iOS prêt)  │      │  public + /admin      │
                    └──────────┬───────────┘      └──────────┬────────────┘
                               │ HTTPS (JSON, JWT)             │ HTTPS (BFF, cookies httpOnly)
                               ▼                               ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │  Reverse proxy (Caddy ou Nginx) : TLS, HSTS, gzip,       │
                 │  limites de taille, en-têtes de sécurité                 │
                 └──────────────────────────┬───────────────────────────────┘
                                            ▼
     ┌──────────────────────────────────────────────────────────────────────────┐
     │  API NestJS (monolithe modulaire, /api/v1, OpenAPI)                      │
     │  auth · users · drivers · vehicles · documents · places · trips ·        │
     │  search · bookings · pricing · payments · payouts · refunds · reviews ·  │
     │  messages · notifications · reports · disputes · promotions · settings · │
     │  admin · audit · stats                                                   │
     │                                                                          │
     │  Workers BullMQ (même code, processus séparé) : expirations, rappels,    │
     │  envoi notifications, traitement webhooks, rapprochement, exports        │
     └──────┬──────────────┬──────────────┬──────────────┬───────────────┬──────┘
            ▼              ▼              ▼              ▼               ▼
     ┌────────────┐ ┌────────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────────────┐
     │ PostgreSQL │ │   Redis    │ │ Stockage S3  │ │  OSRM    │ │ Services externes│
     │ + PostGIS  │ │ files, OTP,│ │ privé (MinIO │ │ routage  │ │ Paiement (agrég.)│
     │            │ │ rate limit │ │ en dev)      │ │ (OSM CI) │ │ SMS OTP, FCM     │
     └────────────┘ └────────────┘ └──────────────┘ └──────────┘ └──────────────────┘
```

## 2. Choix techniques retenus

| Domaine | Choix | Justification | Alternative écartée (MVP) |
|---|---|---|---|
| Mobile | Flutter 3.x (Dart), Riverpod, go_router, Dio, Drift (SQLite) pour le cache, `flutter_map` (OSM) | Un code pour Android et iOS, bonnes performances sur Android d'entrée de gamme | React Native : écosystème cartes moins homogène |
| Web + admin | Next.js 15 (App Router), TypeScript, Tailwind CSS, composants Radix/shadcn, TanStack Query, MapLibre GL / Leaflet | Une seule base, SSR pour le référencement des pages trajets publiques | Deux apps séparées : double maintenance |
| Backend | NestJS 11 (TypeScript strict), Kysely (voir ci-dessous), validation zod, Swagger | Structure modulaire, injection de dépendances, guards pour les rôles | Express nu : moins de cadre |
| SQL | **Kysely** (constructeur de requêtes typé) + **migrations en SQL pur** versionnées avec somme de contrôle ; SQL paramétré pour PostGIS et les verrous `SELECT … FOR UPDATE` *(choix révisé à l'étape 4, voir docs/adr/0001)* | Contrôle total du SQL (PostGIS, contraintes, triggers), pas de moteur binaire à télécharger | Prisma : types PostGIS non pris en charge, migrations en conflit avec le SQL écrit à la main |
| Base | PostgreSQL 16 + PostGIS 3.4 | Transactions, contraintes, géographie | — |
| Cache / files | Redis 7 + BullMQ | Tâches différées (expiration à T+15 min), reprises | RabbitMQ/Kafka : surdimensionné |
| Auth | Implémentation maison conforme aux bonnes pratiques : OTP haché dans Redis, JWT d'accès (15 min, EdDSA), refresh token opaque rotatif stocké haché en base, détection de réutilisation | Contrôle des coûts SMS et des règles anti-abus ; pas de dépendance à un fournisseur d'identité | Firebase Auth Phone : simple mais coût SMS et contrôle limités ; reste une option |
| Cartographie | Tuiles OSM (fournisseur de tuiles à choisir : MapTiler, Stadia, ou auto-hébergé), géocodage par **référentiel interne** + Nominatim auto-hébergé en appoint | Coût maîtrisé, données CI suffisantes pour les axes principaux | Google Maps : meilleure couverture des POI mais facturation par requête |
| Routage | OSRM auto-hébergé (profil voiture, extrait Côte d'Ivoire Geofabrik) | Gratuit, rapide ; résultats mis en cache par couple de points arrondis | GraphHopper / API payante |
| Push | Firebase Cloud Messaging | Standard Android, gratuit | — |
| Stockage | S3 compatible privé (MinIO en dev ; en prod Scaleway, OVH, AWS S3 ou Cloudflare R2), chiffrement côté serveur, URL signées 5 min | Documents jamais publics | — |
| Déploiement | Docker Compose sur un VPS (MVP), puis Kubernetes ou PaaS si croissance | Budget réduit | Kubernetes dès le départ : coût et complexité |
| CI | GitHub Actions : lint, tests, build Docker, build APK | — | — |

## 3. Structure du dépôt (monorepo)

```
ivoirecovoit/
├── apps/
│   ├── backend/                 # NestJS
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── config/          # validation des variables d'environnement (zod)
│   │   │   ├── common/          # guards, interceptors, filters, decorators, idempotence
│   │   │   ├── modules/
│   │   │   │   ├── auth/  users/  drivers/  vehicles/  documents/
│   │   │   │   ├── places/  trips/  search/  routing/
│   │   │   │   ├── bookings/  pricing/  promotions/
│   │   │   │   ├── payments/
│   │   │   │   │   ├── payment-provider.interface.ts
│   │   │   │   │   ├── providers/sandbox/       # adaptateur sandbox
│   │   │   │   │   └── providers/aggregator/    # squelette, non connecté
│   │   │   │   ├── refunds/  payouts/  ledger/  reconciliation/
│   │   │   │   ├── reviews/  messages/  notifications/
│   │   │   │   ├── reports/  disputes/  safety/
│   │   │   │   ├── admin/  settings/  stats/  audit/
│   │   │   └── jobs/            # processeurs BullMQ
│   │   ├── prisma/              # schema.prisma + migrations SQL
│   │   ├── test/                # e2e, concurrence, permissions
│   │   └── Dockerfile
│   ├── web/                     # Next.js (public + admin)
│   │   ├── app/(public)/  app/(account)/  app/admin/
│   │   ├── components/  lib/api/  lib/i18n/
│   │   └── Dockerfile
│   └── mobile/                  # Flutter
│       ├── lib/
│       │   ├── core/            # thème, réseau, stockage, erreurs
│       │   ├── features/        # auth, search, trip, booking, payment, driver, profile, safety…
│       │   └── l10n/
│       └── test/
├── packages/
│   ├── api-client/              # client TypeScript généré depuis OpenAPI
│   └── shared/                  # constantes partagées (statuts, codes d'erreur)
├── infrastructure/
│   ├── docker-compose.yml       # dev : postgres, redis, minio, osrm, mailpit
│   ├── docker-compose.prod.yml
│   ├── caddy/  osrm/  scripts/ (backup, restore, seed)
├── docs/                        # ces documents, ADR, guides d'installation
├── .github/workflows/
├── .env.example
└── README.md
```

Gestion du monorepo : **pnpm workspaces** pour la partie TypeScript ; Flutter reste autonome dans `apps/mobile`.

## 4. Découpage en modules backend et responsabilités

| Module | Responsabilité | Données principales |
|---|---|---|
| auth | OTP, sessions, jetons, 2FA personnel, rate limiting | `auth_identities`, `sessions`, `otp_*` (Redis) |
| users | Profil, consentements, contacts d'urgence, suppression | `users`, `user_consents`, `emergency_contacts` |
| drivers / vehicles / documents | Profil conducteur, véhicules, documents, vérification | `driver_profiles`, `vehicles`, `vehicle_documents`, `driver_documents` |
| places / routing | Référentiel lieux, géocodage, appels OSRM avec cache | `places`, `route_cache` |
| trips / search | Publication, statuts, arrêts, recherche géographique | `trips`, `trip_stops` |
| bookings | Machine à états, verrous, blocage temporaire, acceptation | `bookings`, `booking_passengers`, `booking_status_history` |
| pricing / promotions | Calcul du montant, frais, commission, remises | `fee_rules`, `promotions`, `promotion_redemptions` |
| payments | Interface `PaymentProvider`, intents, webhooks, statut | `payments`, `payment_events` |
| refunds / payouts / ledger / reconciliation | Remboursements, montants dus, écritures, rapprochement | `refunds`, `commissions`, `ledger_entries`, `payouts`, `reconciliation_*` |
| reviews / messages / notifications | Avis, conversations, notifications multicanal | `reviews`, `conversations`, `messages`, `notifications`, `device_tokens` |
| reports / disputes / safety | Signalements, litiges, partage, urgence | `reports`, `disputes`, `dispute_messages`, `trip_shares` |
| admin / settings / stats / audit | RBAC du personnel, paramètres versionnés, statistiques, export, audit | `staff_roles`, `settings`, `audit_logs` |

Règle : un module n'écrit que dans ses tables ; il appelle les autres via leurs services (pas d'accès direct aux tables d'un autre module). Les effets secondaires (notifications, écritures comptables) passent par des **événements de domaine** enregistrés dans une table `outbox_events` dans la même transaction, puis publiés par un worker (pattern *transactional outbox*), ce qui évite d'envoyer une notification pour une transaction annulée.

## 5. Couche de paiement interchangeable

```ts
interface PaymentProvider {
  readonly code: string;                                  // 'sandbox', 'cinetpay', ...
  supportedMethods(): Promise<PaymentMethod[]>;           // WAVE, ORANGE_MONEY, MTN_MOMO, MOOV_MONEY
  initiatePayment(input: {
    paymentId: string;          // notre identifiant, envoyé comme référence marchand
    amountXof: number;          // entier
    method: PaymentMethod;
    payerPhone: string;         // E.164, jamais de PIN
    description: string;
    idempotencyKey: string;
    returnUrl: string;
    notifyUrl: string;
  }): Promise<{ providerReference: string; nextAction: NextAction }>; // REDIRECT url | USSD_PUSH | DEEPLINK
  getPaymentStatus(providerReference: string): Promise<ProviderStatus>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification; // signature, horodatage
  parseWebhook(rawBody: Buffer): NormalizedPaymentEvent;
  refund?(input: { providerReference: string; amountXof: number; reason: string; idempotencyKey: string }): Promise<RefundResult>;
  listTransactions?(from: Date, to: Date): Promise<ProviderTransaction[]>; // pour le rapprochement
}
```

- Le choix du prestataire se fait par configuration (`PAYMENT_PROVIDER`), et par moyen de paiement si plusieurs prestataires coexistent.
- **Règle d'or** : `payments.status = SUCCEEDED` n'est écrit que par le traitement d'un événement vérifié (webhook signé) ou par une réponse `getPaymentStatus` obtenue côté serveur. Le retour du navigateur ou de l'application (`returnUrl`) ne déclenche qu'une interrogation de statut.
- Le **SandboxPaymentProvider** expose une page de paiement factice (`/sandbox/pay/:ref`) avec les boutons « Valider », « Refuser », « Laisser expirer », « Envoyer le webhook deux fois », « Envoyer dans le désordre », pour tester tous les cas. Il signe ses webhooks avec `SANDBOX_WEBHOOK_SECRET`. Le module refuse de se charger si `NODE_ENV=production`.

## 6. Sécurité (résumé de conception)

| Sujet | Mesure |
|---|---|
| Transport | HTTPS obligatoire, HSTS 1 an, TLS 1.2+, redirection HTTP→HTTPS |
| Authentification | OTP haché (HMAC-SHA256 avec secret serveur) dans Redis ; JWT d'accès 15 min signé EdDSA ; refresh token 30 jours rotatif, haché en base, révocation de la famille en cas de réutilisation ; personnel : mot de passe Argon2id + TOTP |
| Web | Jetons dans cookies `HttpOnly; Secure; SameSite=Lax` via le BFF Next.js ; protection CSRF (double soumission) ; CSP stricte ; admin sur sous-domaine distinct |
| Mobile | Refresh token dans Android Keystore (`flutter_secure_storage`) ; pas de données sensibles dans les logs ; certificate pinning envisagé en I2 |
| Autorisations | Guards NestJS : rôle + **propriété de la ressource** vérifiée dans chaque service (anti-IDOR) ; identifiants UUID v7 non devinables ; références publiques distinctes |
| Permissions du personnel | Permissions fines (`users.read`, `users.read_sensitive`, `documents.view`, `refunds.approve`, `settings.write`…) attribuées aux rôles ; « break-glass » : accès aux données sensibles avec motif obligatoire, durée limitée, journalisé |
| Validation | DTO validés (class-validator/zod), whitelist, limites de taille, normalisation des téléphones (libphonenumber) |
| Rate limiting | Redis : par IP, par utilisateur, par numéro (OTP), par route ; réponses 429 avec `Retry-After` |
| Documents | Bucket privé, clés d'objet aléatoires, type MIME vérifié (magie), taille max 8 Mo, suppression des métadonnées EXIF, URL signées 5 min, antivirus (ClamAV) en I2 |
| Webhooks | Vérification de signature HMAC + horodatage (fenêtre 5 min), IP autorisées si le prestataire les publie, corps brut conservé, idempotence par identifiant d'événement |
| Secrets | Variables d'environnement / gestionnaire de secrets ; `.env.example` sans valeurs réelles ; scan de secrets en CI |
| Erreurs | Format standard sans pile ni détail SQL en production ; identifiant de corrélation |
| Audit | `audit_logs` en ajout seul (trigger empêchant UPDATE/DELETE), acteurs, cible, motif, IP, avant/après (sans données sensibles en clair) |
| Géolocalisation | Pas de suivi continu ; position en direct (I2) uniquement pendant un trajet IN_PROGRESS, avec consentement, purge 7 jours après |
| Sauvegardes | Dumps quotidiens chiffrés hors site + WAL ; test de restauration |

## 7. Gestion des réseaux instables

- **Idempotence** : en-tête `Idempotency-Key` (UUID généré par le client) obligatoire sur `POST /bookings`, `POST /bookings/:id/payments`, `POST /bookings/:id/cancel`, `POST /trips`, remboursements admin. Le serveur stocke clé + empreinte de la requête + réponse pendant 24 h ; une répétition renvoie la même réponse ; une clé réutilisée avec un corps différent renvoie 422.
- **Client** : délais d'attente (10 s), reprises exponentielles sur erreurs réseau et 503 pour les requêtes idempotentes uniquement, file locale d'actions non critiques (lecture des notifications), cache local des billets et trajets à venir.
- **Statut de paiement** : l'écran d'attente interroge `GET /payments/:id` toutes les 3 s puis 10 s ; à la reprise de l'application, la réservation en cours est relue depuis le serveur.
- **Charge utile** : pagination par curseur, champs limités par défaut, images servies en WebP redimensionnées.

## 8. Environnements

| Environnement | Paiement | OTP | Données |
|---|---|---|---|
| `development` (local, Docker) | Sandbox | Mode test (code dans les logs) | Seed `[DEMO]` |
| `staging` | Sandbox ou bac à sable du prestataire | Vrai SMS sur numéros de test autorisés | Seed `[DEMO]` |
| `production` | Prestataire réel uniquement | Vrai SMS uniquement | Réelles |

Le service de configuration valide au démarrage que les combinaisons interdites (sandbox ou OTP test en production, secrets manquants) font échouer le lancement.

## 9. Variables d'environnement prévues (aperçu)

```
NODE_ENV, APP_BASE_URL, API_BASE_URL, ADMIN_BASE_URL
DATABASE_URL, REDIS_URL
JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, REFRESH_TOKEN_PEPPER, OTP_HMAC_SECRET
OTP_TEST_MODE (dev/staging uniquement), SMS_PROVIDER, SMS_API_KEY, SMS_SENDER_ID
PAYMENT_PROVIDER (sandbox|aggregator), PAYMENT_API_KEY, PAYMENT_SITE_ID, PAYMENT_WEBHOOK_SECRET, SANDBOX_WEBHOOK_SECRET
S3_ENDPOINT, S3_BUCKET_DOCUMENTS, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION
OSRM_URL, TILE_SERVER_URL, TILE_API_KEY
FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT_JSON
SENTRY_DSN (facultatif)
```

Aucune de ces valeurs n'existe aujourd'hui pour la production ; elles seront listées dans le document « éléments à obtenir » (livrable 18).

## 10. Estimation de l'infrastructure MVP (ordre de grandeur, à confirmer)

- 1 VPS 4 vCPU / 8 Go (API, workers, web, Redis, OSRM CI ~1 Go de RAM) + PostgreSQL managé ou sur second VPS.
- Stockage objet : quelques Go.
- Coûts variables : SMS OTP (principal poste, par message), tuiles cartographiques, commissions du prestataire de paiement (pourcentage par transaction, fixé par contrat).
- Le chiffrage détaillé sera fourni au livrable 17.
