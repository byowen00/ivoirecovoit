# IvoireCovoit : étape 3c, contrats API (principaux endpoints)

> REST JSON, préfixe `/api/v1`, documentation OpenAPI générée par NestJS (`/api/docs`, désactivée ou protégée en production). Statut : proposition à valider.

## 1. Conventions

- **Authentification** : `Authorization: Bearer <access_token>` (mobile) ; cookies `HttpOnly` gérés par le BFF Next.js (web).
- **Idempotence** : `Idempotency-Key: <uuid>` obligatoire sur les endpoints marqués 🔁.
- **Concurrence d'édition** : `If-Match: <version>` sur les modifications de trajet ; 409 si la version a changé.
- **Pagination** : `?cursor=…&limit=20` ; réponse `{ "data": [...], "nextCursor": "…" | null }`.
- **Montants** : entiers en XOF, champs suffixés `Xof` (`totalXof: 5300`). Jamais de décimales.
- **Dates** : ISO 8601 UTC (`2026-10-24T07:30:00Z`) ; l'affichage local est fait par le client.
- **Erreurs** : format unique, sans pile ni détail interne :

```json
{ "error": { "code": "SEATS_UNAVAILABLE", "message": "Il ne reste plus assez de places sur ce trajet.",
             "details": { "available": 0 }, "requestId": "req_01J…" } }
```

| HTTP | Codes métier typiques |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED` |
| 403 | `FORBIDDEN`, `DRIVER_NOT_VERIFIED`, `ACCOUNT_SUSPENDED` |
| 404 | `NOT_FOUND` (aussi renvoyé quand la ressource existe mais n'appartient pas à l'appelant, pour ne rien divulguer) |
| 409 | `SEATS_UNAVAILABLE`, `INVALID_STATE_TRANSITION`, `ALREADY_BOOKED`, `VERSION_CONFLICT`, `PAYMENT_ALREADY_IN_PROGRESS` |
| 422 | `IDEMPOTENCY_KEY_REUSED`, `PROMO_INVALID`, `PRICE_OUT_OF_BOUNDS` |
| 429 | `RATE_LIMITED` (+ `Retry-After`) |
| 503 | `PROVIDER_UNAVAILABLE` |

Légende des permissions : 🌐 public · 👤 utilisateur connecté · 🚗 conducteur vérifié · 🛟 SUPPORT · 🛡 ADMIN · 💰 FINANCE/ADMIN · 👑 SUPER_ADMIN. « Propriétaire » = la ressource doit appartenir à l'appelant (vérifié dans le service).

## 2. Authentification et sessions

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| POST | `/auth/otp/request` | 🌐 | `{ phone, purpose: "LOGIN" }` → `{ otpRequestId, resendAfterS, expiresInS }`. Réponse identique que le numéro existe ou non. Limites : numéro, IP, appareil. |
| POST | `/auth/otp/verify` | 🌐 | `{ otpRequestId, code, deviceLabel }` → `{ accessToken, refreshToken, user, isNewUser }` |
| POST | `/auth/refresh` | 🌐 | `{ refreshToken }` → nouvelle paire (rotation). Réutilisation détectée → révocation de la famille, 401. |
| POST | `/auth/logout` | 👤 | Révoque la session courante |
| GET | `/auth/sessions` | 👤 | Liste des sessions actives |
| DELETE | `/auth/sessions/:id` | 👤 propriétaire | Révoque une session (ou `all`) |
| POST | `/auth/staff/login` | 🌐 | `{ email, password, totp }` personnel uniquement, limites strictes |
| POST | `/auth/recovery` | 🌐 | Demande de récupération via support (numéro perdu) |

## 3. Utilisateurs et profils

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| GET | `/me` | 👤 | Profil complet de l'appelant (rôles, statut conducteur) |
| PATCH | `/me` | 👤 | `{ firstName, lastName, bio, preferences, email }` |
| POST | `/me/photo` | 👤 | Upload (multipart, ≤ 3 Mo, image) |
| PUT | `/me/consents` | 👤 | `{ type, version, granted }` |
| GET/PUT | `/me/emergency-contact` | 👤 | Contact d'urgence privé |
| POST | `/me/device-tokens` 🔁 | 👤 | Enregistrement du jeton FCM |
| GET | `/me/notification-preferences` · PUT | 👤 | Préférences par catégorie |
| DELETE | `/me` | 👤 | Demande de suppression (OTP de confirmation) |
| GET | `/users/:id/public` | 🌐 | Profil public : `displayName`, photo, badges, notes, nombre de trajets, ancienneté, avis publiés |

## 4. Conducteurs, véhicules, documents

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| POST | `/drivers/me` | 👤 | Crée le profil conducteur (`NOT_SUBMITTED`) |
| GET | `/drivers/me` | 👤 | Statut de vérification, documents attendus, motifs de rejet |
| POST | `/drivers/me/documents/upload-url` | 👤 | `{ docType, side, mimeType, sizeBytes, sha256 }` → URL de dépôt signée (PUT, 5 min) + `documentId` |
| POST | `/drivers/me/documents/:id/complete` | 👤 propriétaire | Confirme le dépôt (le serveur vérifie taille, type, empreinte) |
| POST | `/drivers/me/submit` | 👤 | Soumet le dossier pour vérification |
| GET | `/vehicles` | 👤 | Mes véhicules |
| POST | `/vehicles` 🔁 | 👤 conducteur | `{ make, model, color, year, plateNumber, seatsCapacity }` |
| PATCH | `/vehicles/:id` | propriétaire | Modifie (immatriculation ou places → repasse en `PENDING`) |
| DELETE | `/vehicles/:id` | propriétaire | Désactive si aucun trajet actif |
| POST | `/vehicles/:id/documents/upload-url` | propriétaire | Idem documents conducteur |
| GET | `/documents/:id/download-url` | propriétaire, ou 🛡 avec permission `documents.view` + `reason` | URL signée 5 min ; accès admin journalisé |

## 5. Lieux et routage

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| GET | `/places/autocomplete?q=bassam&near=lat,lng` | 🌐 | Suggestions (ville, commune, quartier, repère) avec parent : « Grand-Bassam », « Riviera 2, Cocody » |
| GET | `/places/reverse?lat=&lng=` | 🌐 (limité) | Lieu du référentiel le plus proche |
| POST | `/routing/estimate` | 👤 | `{ points: [[lat,lng],…] }` → `{ distanceM, durationS, geometry, source, isEstimate: true }` |
| GET | `/places/popular-routes` | 🌐 | Axes populaires (Abidjan–Yamoussoukro, –Bouaké, –Daloa, –San Pedro, –Grand-Bassam…) |

## 6. Trajets (conducteur)

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| POST | `/trips` 🔁 | 🚗 | Crée un brouillon ou publie directement (`publish: true`) |
| GET | `/trips/mine?status=&cursor=` | 🚗 | Mes trajets |
| GET | `/trips/:id/manage` | 🚗 propriétaire | Détail avec réservations et passagers |
| PATCH | `/trips/:id` (`If-Match`) | 🚗 propriétaire | Modification selon les règles (doc 05 §6) |
| POST | `/trips/:id/publish` | 🚗 propriétaire | DRAFT → PUBLISHED (vérifie documents valides, chevauchement, horaires) |
| POST | `/trips/:id/duplicate` 🔁 | 🚗 propriétaire | `{ dates: ["2026-10-31", …] }` (≤ 14 dates) |
| POST | `/trips/:id/cancel` 🔁 | 🚗 propriétaire | `{ reason }` → annule, rembourse intégralement les réservations payées |
| POST | `/trips/:id/start` | 🚗 propriétaire | PUBLISHED/FULL → IN_PROGRESS (fenêtre : départ −60 min à +3 h) |
| POST | `/trips/:id/bookings/:bookingId/no-show` | 🚗 propriétaire | Marque un passager absent (trajet en cours, après l'heure de passage) |
| POST | `/trips/:id/complete` | 🚗 propriétaire | IN_PROGRESS → COMPLETED |

Exemple de création :

```json
POST /api/v1/trips
Idempotency-Key: 3f0e…
{
  "vehicleId": "0192…",
  "kind": "INTERCITY",
  "departureAt": "2026-10-24T07:30:00Z",
  "seatsOffered": 3,
  "acceptanceMode": "AUTO",
  "cancellationPolicy": "STANDARD",
  "allowsCash": false,
  "luggagePolicy": "MEDIUM",
  "stops": [
    { "placeId": "…cocody-riviera2", "meetingPoint": "Carrefour Las Palmas, devant la pharmacie", "lat": 5.3631, "lng": -3.9582 },
    { "placeId": "…toumodi", "meetingPoint": "Gare routière de Toumodi", "lat": 6.5526, "lng": -5.0193 },
    { "placeId": "…yamoussoukro", "meetingPoint": "Rond-point de la Fondation", "lat": 6.8276, "lng": -5.2893 }
  ],
  "pricePerSeatXof": 5000,
  "stopPricesXof": [0, 3000, 5000],
  "description": "Départ à l'heure, climatisation.",
  "publish": true
}
```

Réponse `201` : le trajet avec `estimatedDistanceM`, `estimatedDurationS`, `routeSource`, `stops[].plannedAt` calculés, et `isEstimate: true`. Coordonnées ici à titre d'illustration ; en production, elles viennent du référentiel et de la carte.

## 7. Recherche et consultation (passager)

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| GET | `/trips/search` | 🌐 | Paramètres : `fromPlaceId` ou `fromLat,fromLng`, `toPlaceId` ou `toLat,toLng`, `date` (AAAA-MM-JJ, heure locale), `timeFrom`, `timeTo`, `seats` (défaut 1), `maxPriceXof`, `directOnly`, `radiusKm`, `sort` (`departure`,`price`,`distance`,`rating`), `cursor` |
| GET | `/trips/:id` | 🌐 | Détail public : arrêts (coordonnées des points de rencontre arrondies pour les visiteurs, exactes pour les passagers confirmés), conducteur public, véhicule (marque, modèle, couleur ; immatriculation visible seulement par les passagers confirmés), conditions, `seatsAvailable` par segment |
| GET | `/trips/:id/availability?pickupStopId=&dropoffStopId=` | 🌐 | Places restantes sur le segment et prix unitaire |

Élément de résultat :

```json
{
  "tripId": "…", "publicRef": "T-8F2K4M",
  "pickup":  { "stopId": "…", "label": "Riviera 2, Cocody", "plannedAt": "2026-10-24T07:30:00Z", "distanceFromQueryM": 1200 },
  "dropoff": { "stopId": "…", "label": "Yamoussoukro",     "plannedAt": "2026-10-24T10:15:00Z" },
  "estimatedDurationS": 9900, "estimatedDistanceM": 241000, "isEstimate": true,
  "unitPriceXof": 5000, "seatsAvailable": 2, "acceptanceMode": "AUTO",
  "driver": { "id": "…", "displayName": "Koffi K.", "ratingAvg": 4.8, "ratingCount": 32, "verified": true },
  "vehicle": { "make": "Toyota", "model": "Corolla", "color": "Gris" },
  "stopsCount": 1
}
```

## 8. Réservations

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| POST | `/bookings/quote` | 👤 | `{ tripId, pickupStopId, dropoffStopId, seats, promoCode? }` → détail du montant (sans réserver) |
| POST | `/bookings` 🔁 | 👤 | Crée la réservation et bloque les places (doc 05). Réponse : `status` = `PENDING_ACCEPTANCE` ou `PENDING_PAYMENT`, `holdExpiresAt`, montants figés, `reference` |
| GET | `/bookings/mine?scope=upcoming|past` | 👤 | Mes réservations |
| GET | `/bookings/:id` | passager propriétaire ou conducteur du trajet ; 🛟 | Détail, historique des statuts |
| POST | `/bookings/:id/accept` | 🚗 conducteur du trajet | PENDING_ACCEPTANCE → PENDING_PAYMENT (ou CONFIRMED si espèces) |
| POST | `/bookings/:id/reject` | 🚗 conducteur du trajet | `{ reason? }` → REJECTED, places libérées |
| POST | `/bookings/:id/cancel/preview` | passager ou conducteur | Montant remboursable et frais selon la politique, avant confirmation |
| POST | `/bookings/:id/cancel` 🔁 | passager ou conducteur | `{ reason, seatsToCancel? }` |
| POST | `/bookings/:id/confirm-presence` | passager | Confirme la réalisation (ou ouvre un litige) |
| POST | `/bookings/:id/share` | passager | Crée un lien de partage → `{ url, expiresAt }` |
| GET | `/share/:token` | 🌐 (jeton) | Page de partage : trajet, statut, prénom conducteur, véhicule, immatriculation |

Exemple de réponse `POST /bookings` :

```json
{
  "id": "…", "reference": "IC-7K3P9Q", "status": "PENDING_PAYMENT", "paymentStatus": "UNPAID",
  "seats": 1, "unitPriceXof": 5000, "subtotalXof": 5000, "serviceFeeXof": 300, "discountXof": 0, "totalXof": 5300,
  "holdExpiresAt": "2026-10-20T10:15:00Z",
  "cancellationPolicy": { "code": "STANDARD", "summary": "Remboursement intégral jusqu'à 24 h avant le départ…" }
}
```

## 9. Paiements

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| GET | `/payments/methods` | 👤 | Moyens réellement disponibles chez le prestataire configuré (+ `CASH` si activé et autorisé par le trajet) ; indicateur `sandbox: true` en dev |
| POST | `/bookings/:id/payments` 🔁 | passager propriétaire | `{ method, payerPhone }` → `{ paymentId, status: "PENDING", nextAction: { type: "REDIRECT"|"USSD_PUSH"|"DEEPLINK", url?, instructions }, expiresAt }`. 409 si un paiement est déjà en cours ou réussi. |
| GET | `/payments/:id` | passager propriétaire | Statut **serveur** ; si `PENDING` depuis > 30 s, le serveur interroge le prestataire avant de répondre (avec limite) |
| GET | `/me/transactions?cursor=` | 👤 | Paiements et remboursements de l'appelant |
| GET | `/me/earnings?from=&to=` | 🚗 | Gains par trajet : brut, commission, net, statut de versement |
| POST | `/webhooks/payments/:provider` | prestataire (signature) | Corps brut conservé ; vérification signature + horodatage ; réponse 200 rapide puis traitement asynchrone idempotent. Jamais d'authentification par JWT ici. |
| GET | `/sandbox/pay/:providerRef` | dev/staging seulement | Page de paiement simulée |

## 10. Avis, messagerie, notifications

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| POST | `/bookings/:id/reviews` | participant, trajet COMPLETED, ≤ 14 j | `{ rating, comment }` |
| GET | `/users/:id/reviews` | 🌐 | Avis publiés |
| GET | `/bookings/:id/messages` · POST | participants | Messagerie liée à la réservation, limite de débit, masquage des numéros |
| GET | `/notifications?cursor=` | 👤 | Liste |
| POST | `/notifications/read` | 👤 | `{ ids: [...] }` ou `all` |

## 11. Signalements, litiges, sécurité

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| POST | `/reports` 🔁 | 👤 | `{ targetType, targetId, bookingId?, category, description }` |
| POST | `/disputes` 🔁 | participant de la réservation | `{ bookingId, reasonCode, description }` (≤ 7 jours après le trajet) |
| GET | `/disputes/mine` · GET `/disputes/:id` | participant | Suivi |
| POST | `/disputes/:id/messages` | participant | Réponse / pièce justificative |
| GET | `/safety/emergency-numbers` | 🌐 | Numéros configurés par l'admin |

## 12. Administration (`/admin/*`, comptes du personnel uniquement)

Chaque endpoint vérifie une **permission** (et pas seulement un rôle). Toutes les écritures sont journalisées dans `audit_logs`.

| Méthode | Chemin | Permission | Description |
|---|---|---|---|
| GET | `/admin/dashboard?from=&to=` | `stats.read` | Indicateurs clés |
| GET | `/admin/users?q=&status=` | `users.read` | Recherche (téléphone masqué) |
| GET | `/admin/users/:id` | `users.read` | Fiche |
| POST | `/admin/users/:id/reveal` | `users.read_sensitive` | `{ reason, fields: ["phone"] }` → valeurs en clair, journalisé |
| POST | `/admin/users/:id/suspend` · `/unsuspend` · `/ban` | `users.moderate` | `{ reason, until? }` |
| GET | `/admin/verifications?type=driver|vehicle|document&status=PENDING` | `verifications.read` | File de vérification |
| POST | `/admin/verifications/:type/:id/approve` · `/reject` | `verifications.decide` | `{ reason }` |
| GET | `/admin/trips` · `/admin/trips/:id` | `trips.read` | — |
| POST | `/admin/trips/:id/cancel` | `trips.moderate` | Annulation administrative + remboursements |
| GET | `/admin/bookings` · `/admin/bookings/:id` | `bookings.read` | — |
| GET | `/admin/payments` · `/admin/payments/:id` (+ événements) | `payments.read` | — |
| POST | `/admin/payments/:id/recheck` | `payments.read` | Interroge le prestataire, applique le statut vérifié |
| POST | `/admin/refunds` 🔁 | `refunds.create` | `{ bookingId, amountXof, reasonCode, note }` ; au-delà du plafond SUPPORT → `REQUESTED` en attente |
| POST | `/admin/refunds/:id/approve` | `refunds.approve` (≠ demandeur) | Double validation |
| GET | `/admin/commissions` · `/admin/payouts` | `finance.read` | Relevés |
| POST | `/admin/payouts/generate` · `/admin/payouts/:id/mark-paid` | `finance.payouts` | `{ externalReference }` |
| GET | `/admin/reconciliation/runs` · POST `/admin/reconciliation/run` | `finance.reconcile` | Rapprochement et écarts |
| GET | `/admin/disputes` · PATCH `/admin/disputes/:id` · POST `/admin/disputes/:id/decide` | `disputes.manage` | Assignation, décision |
| GET | `/admin/reports` · PATCH `/admin/reports/:id` | `reports.manage` | — |
| GET/PUT | `/admin/settings/:key` | `settings.read` / `settings.write` | Paramètres versionnés |
| GET/POST | `/admin/fee-rules` | `settings.fees` | Nouvelle version (jamais d'édition d'une version utilisée) |
| CRUD | `/admin/promotions` | `promotions.manage` | — |
| CRUD | `/admin/places` | `places.manage` | Référentiel lieux |
| GET | `/admin/stats?groupBy=city|route|period|kind` | `stats.read` | Statistiques |
| POST | `/admin/exports` | `exports.create` | `{ type, from, to }` → tâche asynchrone, fichier CSV en URL signée, colonnes sensibles exclues par défaut |
| GET | `/admin/audit-logs` | `audit.read` | Lecture seule |
| CRUD | `/admin/staff` | 👑 `staff.manage` | Comptes et rôles du personnel |

### Rôles du personnel par défaut (modifiables)

| Permission | SUPPORT | ADMIN | FINANCE | SUPER_ADMIN |
|---|:-:|:-:|:-:|:-:|
| users.read, trips.read, bookings.read, payments.read | ✓ | ✓ | ✓ | ✓ |
| users.read_sensitive (avec motif) | — | ✓ | — | ✓ |
| documents.view (avec motif) | — | ✓ | — | ✓ |
| verifications.decide | — | ✓ | — | ✓ |
| users.moderate | suspension ≤ 72 h | ✓ | — | ✓ |
| disputes.manage, reports.manage | ✓ | ✓ | — | ✓ |
| refunds.create | ≤ plafond | ✓ | ✓ | ✓ |
| refunds.approve | — | ✓ | ✓ | ✓ |
| finance.*, exports.create | — | lecture | ✓ | ✓ |
| settings.*, promotions.manage, places.manage | — | ✓ | — | ✓ |
| staff.manage, audit.read | — | audit.read | — | ✓ |
