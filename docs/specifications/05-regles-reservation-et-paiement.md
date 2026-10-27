# IvoireCovoit : étape 3d, règles de réservation, de paiement et de commission

> Statut : proposition à valider. **Toutes les durées, pourcentages et montants ci-dessous sont des valeurs par défaut paramétrables**, pas des décisions commerciales. Les valeurs marquées *(démo)* servent uniquement aux données de démonstration.

## 1. Machine à états des trajets

```
DRAFT ──publish──▶ PUBLISHED ◀──place libérée── FULL
  │                  │  └──plus de place──▶ FULL
  │                  ├──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
  │                  │              ▲  (FULL ──start──▶ IN_PROGRESS)
  └──cancel──▶ CANCELLED ◀──cancel── PUBLISHED | FULL
```

| Transition | Qui | Conditions |
|---|---|---|
| DRAFT → PUBLISHED | Conducteur | Conducteur et véhicule approuvés, documents non expirés, départ dans [+30 min ; +90 j], pas de chevauchement de véhicule, prix dans les bornes, ≥ 2 arrêts ordonnés dans le temps |
| PUBLISHED ↔ FULL | Système | Automatique selon l'occupation maximale (calculée sur le segment le plus chargé, voir §3). FULL signifie « plus aucune place sur aucun segment complet origine→destination » ; des segments partiels peuvent rester réservables ; l'affichage s'appuie sur la disponibilité par segment |
| PUBLISHED/FULL → IN_PROGRESS | Conducteur | Entre départ −60 min et départ +3 h. Les réservations non confirmées (en attente d'acceptation ou de paiement) passent en EXPIRED |
| IN_PROGRESS → COMPLETED | Conducteur ; ou système 12 h après l'arrivée estimée si non déclaré (marqué « clôture automatique ») | Les réservations CONFIRMED non marquées absentes passent en COMPLETED |
| PUBLISHED/FULL → CANCELLED | Conducteur, admin | Toutes les réservations actives sont annulées par le conducteur/admin, remboursement intégral (§7) |
| PUBLISHED non démarré à départ +3 h | Système | Alerte au conducteur ; à +6 h : passage en CANCELLED avec motif « trajet non démarré », remboursement intégral, pénalité de fiabilité |

Transitions interdites (rejetées avec `INVALID_STATE_TRANSITION`) : toute sortie de COMPLETED ou CANCELLED, IN_PROGRESS → CANCELLED (passe par un litige), DRAFT → IN_PROGRESS.

## 2. Machine à états des réservations

Deux statuts distincts : **statut de réservation** (`status`) et **statut de paiement** (`payment_status`).

```
                      ┌──────reject / timeout───────▶ REJECTED / EXPIRED
                      │
create(MANUAL) ─▶ PENDING_ACCEPTANCE ──accept──┐
                      │                         ▼
create(AUTO) ──────────────────────────▶ PENDING_PAYMENT ──paiement vérifié──▶ CONFIRMED ──fin trajet──▶ COMPLETED
                      │                         │                                 │  └──absence──▶ NO_SHOW
                      │                         ├──échec définitif / expiration──▶ EXPIRED
                      └──cancel──▶ CANCELLED_*  └──cancel──▶ CANCELLED_*           └──cancel──▶ CANCELLED_* (+ remboursement)
```

Mode espèces (si activé) : `accept` (MANUAL) ou `create` (AUTO) mène directement à CONFIRMED avec `payment_status = CASH_DUE`.

| Statut réservation | Places bloquées ? | `payment_status` possibles |
|---|---|---|
| PENDING_ACCEPTANCE | Oui | UNPAID |
| PENDING_PAYMENT | Oui (jusqu'à `hold_expires_at`) | UNPAID, PROCESSING |
| CONFIRMED | Oui | PAID, CASH_DUE |
| REJECTED, EXPIRED | Non | UNPAID (un paiement tardif réussi déclenche un remboursement automatique, §5.4) |
| CANCELLED_BY_PASSENGER / DRIVER / ADMIN | Non | UNPAID, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED, PAID (si non remboursable) |
| NO_SHOW | Non (trajet en cours) | PAID (pas de remboursement par défaut, contestable par litige) |
| COMPLETED | — | PAID, CASH_DUE (espèces : considéré réglé), PARTIALLY_REFUNDED (après litige) |

Chaque changement est écrit dans `booking_status_history` et produit un événement d'outbox. Un trigger PostgreSQL refuse les transitions absentes de la table de transitions autorisées (deuxième ligne de défense après le service).

## 3. Anti-survente : algorithme de réservation

**Modèle de capacité** : les arrêts d'un trajet découpent l'itinéraire en segments `[seq, seq+1)`. Une réservation `pickup_seq → dropoff_seq` occupe ses `seats` sur chacun des segments couverts. La contrainte est : pour chaque segment, la somme des places des réservations **bloquantes** (PENDING_ACCEPTANCE, PENDING_PAYMENT non expirée, CONFIRMED) ≤ `seats_offered`.

**Transaction `POST /bookings`** (niveau d'isolation READ COMMITTED + verrou explicite) :

```
BEGIN;
  -- 1. Idempotence : si (user, Idempotency-Key) existe → renvoyer la réponse stockée
  -- 2. Verrou exclusif sur la ligne du trajet : sérialise toutes les réservations du MÊME trajet,
  --    sans bloquer les autres trajets
  SELECT id, status, seats_offered, driver_id, departure_at FROM trips WHERE id = :trip FOR UPDATE;
  -- 3. Vérifications : trajet PUBLISHED, départ > maintenant + délai minimal (30 min par défaut),
  --    passager ≠ conducteur, compte actif, arrêts valides et ordonnés,
  --    pas de réservation active du passager sur ce trajet (index unique partiel = filet de sécurité),
  --    nombre de réservations en attente du passager < limite (3 par défaut)
  -- 4. Occupation max sur les segments demandés :
  SELECT max(occ) FROM (
    SELECT g.seq, coalesce(sum(b.seats),0) AS occ
    FROM generate_series(:pickup_seq, :dropoff_seq - 1) g(seq)
    LEFT JOIN bookings b ON b.trip_id = :trip
      AND b.status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT','CONFIRMED')
      AND (b.hold_expires_at IS NULL OR b.hold_expires_at > now() OR b.status = 'CONFIRMED')
      AND b.pickup_seq <= g.seq AND b.dropoff_seq > g.seq
    GROUP BY g.seq) s;
  --    si max(occ) + :seats > seats_offered → ROLLBACK, 409 SEATS_UNAVAILABLE
  -- 5. Calcul des montants (§8) avec la version courante de fee_rules ; réservation du code promo
  --    (UPDATE promotions SET redemptions_count = redemptions_count + 1
  --     WHERE id = :p AND (max_redemptions IS NULL OR redemptions_count < max_redemptions) → 0 ligne = PROMO_INVALID)
  -- 6. INSERT bookings (status PENDING_ACCEPTANCE ou PENDING_PAYMENT, hold_expires_at, montants figés)
  -- 7. Recalcul : si plus aucune place sur le trajet complet → trips.status = 'FULL'
  -- 8. INSERT booking_status_history, outbox_events (notification conducteur/passager)
  -- 9. Enregistrement de la réponse dans idempotency_keys
COMMIT;
-- Après COMMIT : planification BullMQ de l'expiration à hold_expires_at (ou acceptance_deadline)
```

Pourquoi ce choix : le verrou de ligne `FOR UPDATE` sur le trajet garantit que deux transactions concurrentes pour le même trajet s'exécutent l'une après l'autre ; la seconde voit l'insertion de la première et échoue proprement. Le volume par trajet est faible (≤ 8 places), donc la contention est négligeable. Les places expirées sont ignorées par la condition sur `hold_expires_at` même si la tâche d'expiration n'est pas encore passée, ce qui évite qu'une panne de Redis bloque des places.

**Libération des places** : la tâche d'expiration rejoue la même logique sous verrou : si la réservation est encore PENDING_* et que l'échéance est passée, et qu'aucun paiement n'est `PENDING` côté prestataire après interrogation, elle passe en EXPIRED ; si un paiement est encore en cours chez le prestataire, l'échéance est prolongée une fois de 10 min (le passager peut être en train de valider sur son téléphone). Une tâche de rattrapage toutes les 5 minutes traite les échéances oubliées.

## 4. Délais par défaut (paramétrables)

| Paramètre | Défaut |
|---|---|
| Délai minimal entre réservation et départ | 30 min |
| Blocage pendant le paiement (`booking.hold_minutes`) | 15 min, prolongeable une fois de 10 min si paiement en cours chez le prestataire |
| Délai d'acceptation en mode MANUAL | 12 h, plafonné à départ −2 h ; si le départ est dans moins de 3 h, le mode MANUAL est refusé à la réservation (AUTO forcé ou réservation impossible, au choix du conducteur) |
| Délai de paiement après acceptation | 15 min (même blocage) |
| Réservations en attente simultanées par passager | 3 |
| Places max par réservation | min(4, places offertes) |
| Fenêtre d'évaluation | 14 jours |
| Fenêtre d'ouverture de litige | 7 jours après la fin du trajet |
| Délai avant que la commission soit « payable » au conducteur | 48 h après COMPLETED sans litige ouvert |

## 5. Paiement : règles de traitement

### 5.1 Initialisation

1. `POST /bookings/:id/payments` avec `Idempotency-Key`. Le serveur vérifie : réservation PENDING_PAYMENT, appartenant à l'appelant, blocage non expiré, aucun paiement CREATED/PENDING/SUCCEEDED (index uniques partiels).
2. Création de `payments` (CREATED) dans une transaction, **puis** appel au prestataire hors transaction (avec la clé d'idempotence transmise si le prestataire la supporte). Réponse → `PENDING` + `provider_reference`. Échec réseau → le paiement reste CREATED ; une tâche interroge le prestataire par notre référence ; si aucun paiement n'existe chez lui après le délai, il passe en FAILED et le passager peut réessayer.
3. `booking.payment_status = PROCESSING`.

### 5.2 Confirmation (seule source de vérité : le prestataire)

Le paiement passe en SUCCEEDED uniquement si **toutes** ces conditions sont réunies :
- l'événement provient d'un webhook dont la signature et l'horodatage sont valides, **ou** d'une interrogation `getPaymentStatus` faite par notre serveur ;
- la référence correspond à un `payments.id` connu ;
- le montant et la devise rapportés sont **égaux** à `amount_xof` / `XOF` (sinon `MISMATCH` : paiement mis en revue, alerte finance, pas de confirmation) ;
- le statut rapporté est un statut final de succès du prestataire.

Traitement d'un événement (idempotent, dans une transaction) :

```
INSERT INTO payment_events (... provider_event_id ...) ON CONFLICT DO NOTHING
  → si aucune ligne insérée : DUPLICATE, réponse 200, rien d'autre
SELECT * FROM payments WHERE id = :ref FOR UPDATE
SELECT * FROM bookings WHERE id = payment.booking_id FOR UPDATE
si payment.status est déjà final (SUCCEEDED/FAILED/EXPIRED) :
   - même statut → DUPLICATE
   - SUCCEEDED reçu alors que FAILED/EXPIRED enregistré → on applique SUCCEEDED (le prestataire fait foi)
     puis on traite selon l'état de la réservation (§5.4)
   - FAILED reçu alors que SUCCEEDED enregistré → IGNORED_STALE + alerte (un succès vérifié n'est jamais annulé
     automatiquement ; un éventuel renversement passe par revue humaine)
sinon : appliquer la transition, mettre à jour la réservation, écrire le grand livre, outbox
```

Les webhooks reçus **dans le désordre** sont gérés car on ne s'appuie pas sur l'ordre d'arrivée mais sur la règle « un état final ne régresse pas » ; l'horodatage `occurred_at` du prestataire sert au diagnostic.

### 5.3 Effets d'un paiement réussi sur une réservation PENDING_PAYMENT

Dans la même transaction : `bookings.status = CONFIRMED`, `payment_status = PAID`, `confirmed_at`, création de la ligne `commissions` (statut PENDING), écritures du grand livre (§9), promo `RESERVED → USED`, outbox : notifications « Paiement confirmé » (passager) et « Nouvelle réservation confirmée » (conducteur).

### 5.4 Paiement réussi arrivé trop tard

Si la réservation est déjà EXPIRED, REJECTED ou CANCELLED quand le succès arrive :
- si des places sont encore disponibles sur le segment et que la réservation était EXPIRED depuis moins de 30 min et que le trajet n'a pas démarré : **ré-activation** sous verrou (même contrôle de capacité que §3) → CONFIRMED ;
- sinon : remboursement intégral automatique (`refunds` motif `LATE_PAYMENT`), notification explicative au passager.

### 5.5 Échec

Échec définitif (refusé, solde insuffisant, annulé par le payeur, expiré chez le prestataire) → `payments.status = FAILED/EXPIRED`, `booking.payment_status = UNPAID`. La réservation reste PENDING_PAYMENT tant que le blocage n'a pas expiré, ce qui permet de réessayer avec un autre moyen ; à l'expiration → EXPIRED, places libérées.

### 5.6 Ce que le client peut et ne peut pas faire

- Le retour de l'application ou du navigateur après paiement (`returnUrl`, lien profond) **ne change aucun statut** ; il déclenche seulement `GET /payments/:id`.
- Aucun PIN, mot de passe ni OTP opérateur n'est saisi dans IvoireCovoit.
- Le numéro payeur est stocké masqué ; le numéro complet n'est transmis qu'au prestataire.

### 5.7 Rapprochement

Tâche quotidienne (et manuelle depuis l'admin) : récupère les transactions du prestataire sur la période (API ou fichier importé), compare à `payments` : absent chez nous, absent chez lui, montant différent, statut différent. Chaque écart crée un `reconciliation_items` à traiter ; un paiement PENDING de plus de 2 h est automatiquement réinterrogé.

## 6. Modification d'un trajet ayant des réservations

| Modification | Règle |
|---|---|
| Description, consignes, préférences | Libre, sans notification |
| Ajout de places (dans la limite du véhicule) | Libre ; FULL → PUBLISHED si applicable |
| Retrait de places | Seulement jusqu'au nombre de places occupées |
| Heure de départ décalée ≤ 30 min | Autorisé, notification aux passagers |
| Heure décalée > 30 min, changement de point de rencontre ou d'arrêt | Autorisé, notification ; chaque passager peut annuler **sans frais** (remboursement intégral, frais de service compris) jusqu'au départ |
| Suppression d'un arrêt utilisé par une réservation | Interdit : annuler la réservation concernée (annulation conducteur) |
| Hausse de prix | Sans effet sur les réservations existantes (prix figé) ; s'applique aux nouvelles |
| Baisse de prix | S'applique aux nouvelles réservations ; pas de remboursement automatique de la différence au MVP |
| Changement de véhicule | Autorisé si capacité suffisante et véhicule approuvé ; notification |

Toutes les modifications utilisent `If-Match` (verrou optimiste `trips.version`) et sont journalisées.

## 7. Annulations, absences, retards, remboursements

Les politiques sont définies par l'admin. Proposition par défaut (à valider commercialement) :

### 7.1 Annulation par le passager

| Politique | > 24 h avant le départ | Entre 24 h et 2 h | < 2 h ou après le départ |
|---|---|---|---|
| FLEXIBLE | 100 % de la part trajet | 100 % | 50 % |
| STANDARD | 100 % | 50 % | 0 % |
| STRICT | 50 % | 0 % | 0 % |

- Les **frais de service** ne sont pas remboursés en cas d'annulation passager, sauf si l'annulation a lieu dans les 15 minutes suivant la confirmation et plus de 24 h avant le départ (droit de rétractation commercial, paramétrable).
- La part non remboursée de la part trajet est **due au conducteur** (moins la commission au prorata), ce qui compense une place réservée inutilement.
- Le montant exact est calculé par `POST /bookings/:id/cancel/preview` et affiché avant confirmation ; il est figé à la confirmation.
- Annulation d'une réservation non payée (PENDING_*) : aucun frais, places libérées.
- Annulation partielle (réduire le nombre de places) : même calcul appliqué aux places annulées.

### 7.2 Annulation par le conducteur

- Remboursement **intégral** de toutes les réservations payées (part trajet + frais de service).
- Aucune somme due au conducteur ; commissions annulées (VOID).
- Compteur `cancellation_count_90d` incrémenté ; au-delà d'un seuil (3 en 90 jours par défaut), alerte admin et éventuelle suspension de publication. Les annulations pour motif « urgence » restent comptées mais peuvent être neutralisées par l'admin après examen.

### 7.3 Annulation par l'admin

Remboursement intégral par défaut ; l'admin peut décider d'une autre répartition avec motif (double validation si au-delà du plafond).

### 7.4 Absence (no-show)

- **Passager absent** : le conducteur le marque absent au plus tôt 15 minutes après l'heure de passage prévue au point de montée, trajet IN_PROGRESS. Statut NO_SHOW ; pas de remboursement ; le passager est notifié et peut contester par un litige sous 7 jours.
- **Conducteur absent** : le passager ouvre un litige « conducteur absent ». Si le trajet n'a jamais été démarré, remboursement automatique (§1, trajet non démarré). S'il a été démarré, le support arbitre ; pendant le litige, la commission du conducteur n'est pas payable.

### 7.5 Retards

- Retard du conducteur > 30 min sur l'heure de passage sans modification déclarée : le passager peut annuler sans frais depuis l'application (option visible à partir de +30 min), remboursement intégral.
- Retard du passager : laissé à l'appréciation du conducteur ; s'il part sans lui après 15 min, il marque l'absence.

### 7.6 Exécution des remboursements

1. Création d'un `refunds` (idempotent) ; booking `payment_status = REFUND_PENDING`.
2. Si le prestataire offre une API de remboursement : appel, statut PROCESSING, confirmation par webhook/interrogation (mêmes règles que les paiements) → SUCCEEDED → `REFUNDED` ou `PARTIALLY_REFUNDED`.
3. Sinon : statut `MANUAL_REQUIRED`, apparaît dans la file finance ; l'opérateur effectue le transfert hors plateforme et saisit la référence → SUCCEEDED. Délai annoncé au passager (à définir).
4. Contrôle : la somme des remboursements non rejetés ne dépasse jamais le montant payé (trigger).

## 8. Calcul des montants

Pour une réservation de `n` places :

```
unit_price      = prix(dropoff) − prix(pickup)                 (XOF entier, multiple de 50)
subtotal        = unit_price × n
service_fee     = clamp(ceil(subtotal × service_fee_bps / 10000) + service_fee_fixed, min, max)
commission      = clamp(round_half_up(subtotal × commission_bps / 10000) + commission_fixed, min, max)
commission      = min(commission, subtotal)
discount        = promo (plafonnée, ≤ subtotal + service_fee), financée par la plateforme
total           = subtotal + service_fee − discount             (montant payé par le passager)
driver_net      = subtotal − commission                         (dû au conducteur)
platform_gross  = service_fee + commission − discount           (peut être négatif en cas de promo forte : suivi en charge promo)
```

- Calcul en entiers (`bigint` côté base, `bigint`/`number` entier contrôlé côté TypeScript avec une fonction utilitaire unique testée), arrondis explicites.
- Exemple *(démo)* : prix 5 000, 1 place, frais 6 %, commission 10 % → `service_fee = 300`, `total = 5 300`, `commission = 500`, `driver_net = 4 500`, revenu plateforme = 800.
- **Plafond « partage de frais »** : le prix par place d'un segment ne peut dépasser `distance_estimée_km × plafond_xof_par_km` (paramètre, défaut à définir après étude ; affiché au conducteur). Plancher : 500 XOF *(démo)*.
- Mode espèces : `service_fee` et `commission` restent calculés et enregistrés ; le passager paie `subtotal` au conducteur (les frais de service en espèces sont à définir, désactivés par défaut) ; la commission devient une **créance** sur le conducteur, déduite des prochains versements ou facturée.

## 9. Écritures comptables (grand livre en partie double)

| Opération | Débit | Crédit |
|---|---|---|
| Paiement réussi (total) | PROVIDER_CLEARING `total` ; PROMO_EXPENSE `discount` | DRIVER_PAYABLE `driver_net` ; PLATFORM_REVENUE_COMMISSION `commission` ; PLATFORM_REVENUE_FEES `service_fee` |
| Remboursement | DRIVER_PAYABLE / REVENUE (selon la répartition de la politique) | PROVIDER_CLEARING `montant remboursé` |
| Versement au conducteur | DRIVER_PAYABLE `montant` | PROVIDER_CLEARING (ou BANK) `montant` |
| Frais du prestataire (si connus) | PROVIDER_FEES | PROVIDER_CLEARING |

Chaque `journal_id` est équilibré (somme nulle, vérifiée par trigger différé). Le solde de DRIVER_PAYABLE par conducteur = montant dû, base du relevé.

## 10. Sécurité anti-fraude des réservations

- Limite de réservations en attente par passager et par appareil ; limite de créations par heure.
- Un passager dont 3 réservations expirent sans paiement en 24 h est temporairement limité (paramétrable).
- Réservations impossibles sur son propre trajet, et alerte si conducteur et passager partagent le même appareil ou le même numéro payeur de façon répétée (suspicion de fausses réservations pour gonfler la note).
- Avis possibles uniquement sur réservation COMPLETED et payée (ou espèces confirmées par les deux parties).
- Codes promo : un par réservation, limites par utilisateur et par appareil, première course seulement si configuré.
