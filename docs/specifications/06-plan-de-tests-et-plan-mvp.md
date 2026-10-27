# IvoireCovoit : plan de tests et plan de développement du MVP

> Statut : proposition à valider. **Aucun test n'a encore été exécuté** : il n'existe pas encore de code. Les résultats réels seront rapportés à chaque étape.

## 1. Stratégie de test

| Niveau | Outils | Portée | Exécution |
|---|---|---|---|
| Unitaires backend | Jest | Calcul des montants, politiques d'annulation, machines à états, normalisation téléphone/immatriculation, masquage des messages, signature webhook | À chaque commit (CI) |
| Intégration API | Jest + Supertest + **PostgreSQL/PostGIS et Redis réels** via Testcontainers (ou Docker Compose en CI) | Endpoints, transactions, contraintes, triggers, permissions | À chaque commit |
| Concurrence | Jest + `Promise.all` de N requêtes réelles sur des connexions distinctes | Survente, doubles soumissions, webhooks simultanés | À chaque commit |
| Contrat | Validation des réponses contre le schéma OpenAPI généré | Cohérence API / clients | À chaque commit |
| Sécurité | Tests de permissions automatisés (matrice rôle × endpoint), OWASP ZAP baseline sur staging, `npm audit`/`osv-scanner`, gitleaks | IDOR, accès admin, en-têtes, secrets | Commit + nocturne |
| Web | Vitest + Testing Library (formulaires), Playwright (parcours critiques) | Recherche, réservation, paiement sandbox, admin | Commit (unitaires), nocturne (E2E) |
| Mobile | `flutter test` (widgets, logique), `integration_test` sur émulateur Android | Formulaires, états réseau, parcours réservation | Commit (unitaires), nocturne (intégration) |
| Builds | `flutter build apk`, `next build`, `docker build` | Build Android, web, images | Commit sur `main` ; iOS seulement sur runner macOS si disponible |
| Charge | k6 | Recherche (ENF-01), pic de réservations sur un trajet | Avant mise en production |

Données de test : fabriques (factories) déterministes, base remise à zéro par suite, horloge contrôlable (`Clock` injecté) pour tester expirations et fenêtres de temps.

## 2. Cas imposés (tests explicites)

| # | Scénario | Type | Préparation | Attendu |
|---|---|---|---|---|
| T1 | **Deux passagers réservent la dernière place** | Concurrence | Trajet 3 places, 2 occupées ; passagers A et B envoient `POST /bookings` (1 place) simultanément, 50 répétitions du test | Exactement une réponse 201 et une 409 `SEATS_UNAVAILABLE` à chaque fois ; occupation finale = 3 ; trajet FULL ; aucune ligne orpheline |
| T1b | Variante : 10 passagers simultanés sur 3 places libres, places mixtes (1 et 2) | Concurrence | — | Somme des places confirmées ≤ 3 ; invariant vérifié par requête SQL |
| T1c | Variante segments : A réserve Abidjan→Toumodi, B Toumodi→Yamoussoukro sur la dernière place | Intégration | Trajet 1 place, 3 arrêts | Les deux réussissent (segments disjoints) ; C Abidjan→Yamoussoukro échoue |
| T2 | **Webhook de paiement reçu deux fois** | Intégration + concurrence | Paiement PENDING ; même webhook signé envoyé 2 fois en séquence, puis 2 fois en parallèle | Une seule transition SUCCEEDED ; un seul `commissions` ; un seul journal comptable ; second événement `DUPLICATE` ; une seule notification « paiement confirmé » ; réponses 200 aux deux |
| T2b | Webhooks dans le désordre : SUCCEEDED puis PENDING ancien | Intégration | — | Statut final SUCCEEDED ; événement ancien `IGNORED_STALE` |
| T2c | Signature invalide / horodatage trop ancien / montant différent | Sécurité | — | 401 et rien d'appliqué / rejet / `MISMATCH` + alerte, réservation non confirmée |
| T3 | **Paiement échoue après la création de la réservation** | Intégration | Réservation PENDING_PAYMENT ; sandbox renvoie FAILED | `payments` FAILED, réservation toujours PENDING_PAYMENT, nouvel essai possible ; à `hold_expires_at` (horloge avancée) → EXPIRED, places libérées, promo libérée, notification |
| T3b | Paiement réussi après expiration | Intégration | Réservation EXPIRED, place reprise par un autre | Remboursement automatique `LATE_PAYMENT` créé ; pas de survente |
| T3c | Le client affiche « succès » sans webhook | Intégration | Appel du `returnUrl` sans événement prestataire | Réservation reste PENDING_PAYMENT ; seul l'appel de statut serveur fait foi |
| T4 | **Le conducteur annule un trajet déjà réservé** | Intégration | 2 réservations payées, 1 en attente d'acceptation | Trajet CANCELLED ; 2 remboursements intégraux (frais de service compris) ; réservation en attente → CANCELLED_BY_DRIVER sans remboursement ; commissions VOID ; grand livre équilibré ; notifications aux 3 passagers ; compteur d'annulations +1 |
| T5 | **Un utilisateur tente d'accéder aux données d'un autre** | Permissions | Utilisateurs A et B | `GET /bookings/{réservation de B}` par A → 404 ; `GET /documents/{doc de B}/download-url` → 404 ; `PATCH /trips/{trajet de B}` → 404 ; `POST /bookings/{B}/cancel` → 404 ; messages d'une conversation tierce → 404 ; aucune fuite dans les messages d'erreur. Test généré pour **chaque** endpoint portant un identifiant |
| T6 | **Requête d'administration par un utilisateur non autorisé** | Permissions | Passager, conducteur, SUPPORT | Tout `/admin/*` avec jeton utilisateur → 403 ; SUPPORT sur `/admin/settings` (écriture), `/admin/fee-rules`, `/admin/staff`, `refunds/approve` → 403 ; SUPPORT révélant un document → 403 ; chaque refus journalisé |

## 3. Autres tests prévus

### Règles métier (unitaires)

- Calcul des montants : arrondis, min/max, promo plafonnée, commission ≤ sous-total, invariants `total = subtotal + fee − discount` et `driver_net = subtotal − commission` sur 10 000 cas aléatoires (test de propriétés avec fast-check).
- Politiques d'annulation : chaque palier, bornes exactes (24 h pile, 2 h pile), annulation partielle, rétractation 15 min.
- Machine à états : toutes les transitions autorisées passent, toutes les autres sont rejetées (table exhaustive), en service **et** par le trigger SQL.
- Prix des segments, plafond par km, multiples de 50.
- Masquage des numéros dans les messages (`07 07 07 07 07`, `+225…`, `zéro sept…` simple).

### Authentification

- OTP : expiration, 5 essais, limites d'envoi, code d'un autre numéro refusé, mode test refusé si `NODE_ENV=production` (le serveur ne démarre pas).
- Rotation du refresh token, réutilisation → révocation de la famille.
- Compte suspendu : accès refusé, sessions révoquées.

### Trajets et recherche

- Publication refusée : conducteur non vérifié, assurance expirée, chevauchement de véhicule (contrainte d'exclusion), départ trop proche ou trop lointain, places > capacité.
- Recherche : correspondances par arrêt intermédiaire, ordre des arrêts respecté, rayon, `directOnly`, prix max, filtrage des trajets FULL sur le segment, tolérance « Yamoussokro ». Jeu de données de référence avec les axes Abidjan–Yamoussoukro, –Bouaké, –Daloa, –San Pedro, –Grand-Bassam et des trajets intra-Abidjan.
- Modification avec réservations : notification, annulation sans frais ouverte, `If-Match` obsolète → 409.

### Réservations

- Double soumission avec la même `Idempotency-Key` → même réponse, une seule réservation ; même clé corps différent → 422.
- Réservation de son propre trajet → refus ; deuxième réservation active sur le même trajet → 409.
- Mode MANUAL : acceptation, refus, expiration du délai.
- Démarrage du trajet : réservations en attente → EXPIRED.
- No-show, retard > 30 min (annulation sans frais), clôture automatique.

### Paiements, remboursements, finance

- Sandbox : succès, échec, expiration, webhook double, désordre, montant différent.
- Remboursement total, partiel, plafond (la somme ne dépasse jamais le payé), remboursement manuel, double validation au-delà du plafond SUPPORT.
- Grand livre : chaque journal équilibré ; solde DRIVER_PAYABLE = somme des nets payables.
- Rapprochement : chaque type d'écart détecté sur un fichier prestataire fabriqué.
- Le module sandbox refuse de se charger en production.

### Sécurité

- Matrice complète rôle × endpoint générée depuis les métadonnées des contrôleurs.
- Upload : mauvais type MIME (fichier .exe renommé .jpg), taille excessive, URL signée expirée.
- Export CSV : cellules commençant par `=`, `+`, `-`, `@` neutralisées.
- En-têtes HTTP (HSTS, CSP, X-Content-Type-Options), CORS limité aux origines connues.
- Rate limiting : 429 attendus sur OTP, réservations, messages.
- Audit : chaque action sensible produit une ligne ; UPDATE/DELETE sur `audit_logs` rejeté.

### Interfaces

- Formulaires critiques (web et mobile) : téléphone, OTP, recherche, publication, réservation, paiement : validations, messages d'erreur en français, états de chargement, bouton désactivé pendant l'envoi.
- Réseau : coupure pendant l'attente de paiement puis reprise → l'écran retrouve le bon statut ; délai d'attente → message « Réessayer ».
- Accessibilité : contrôle automatique (axe-core sur le web), tailles de police agrandies sur mobile.

## 4. Plan de développement (étapes 4 à 10)

Chaque étape se termine par : fonctionnalités terminées, fichiers créés/modifiés, commandes exécutées, résultats réels des tests, problèmes restants, étape suivante.

| Étape | Contenu | Livrables vérifiables |
|---|---|---|
| **4. Structure et environnements** | Monorepo pnpm, NestJS, Next.js, Flutter initialisés ; Docker Compose (PostgreSQL+PostGIS, Redis, MinIO, OSRM avec extrait CI, Mailpit) ; validation des variables d'environnement ; migrations 0001-0011 ; seeds référence + démo ; CI GitHub Actions ; système de design (couleurs, typographie, composants de base) et maquettes des écrans clés | `docker compose up` démarre tout ; migrations appliquées ; `/api/health` OK ; CI verte |
| **5. Auth, rôles, profils** | OTP (mode test dev), sessions, refresh rotatif, guards rôles/permissions, profil, consentements, comptes du personnel + TOTP, audit | Tests auth + matrice de permissions initiale ; écrans 1, 2, 3, 15 (mobile et web) |
| **6. Véhicules, trajets, recherche** | Profil conducteur, documents (URL signées), vérification admin, référentiel lieux, routage OSRM + repli, publication, arrêts, prix des segments, recherche PostGIS, carte | Tests trajets/recherche ; écrans 4, 5, 6, 7, 10, 11 |
| **7. Réservations** | Algorithme §3 du doc 05, idempotence, blocage et expiration (BullMQ), mode MANUAL, annulations et politiques, no-show | **T1, T1b, T1c, T4 (partie réservation), T5** ; écrans 8, 12 |
| **8. Paiement sandbox et webhooks** | `PaymentProvider`, `SandboxPaymentProvider`, squelette d'adaptateur agrégateur, webhooks signés, remboursements, commissions, grand livre, relevés, rapprochement | **T2, T2b, T2c, T3, T3b, T3c, T4 complet** ; écrans 9, 14 |
| **9. Admin, notifications, réclamations** | Tableau de bord, vérifications, gestion trajets/réservations/paiements/remboursements, litiges, signalements, paramètres versionnés, promotions, stats, export CSV, audit, rôles ; notifications in-app + FCM ; messagerie ; partage de trajet ; urgence ; avis | **T6** ; écrans 13, 16, 17 |
| **10. Tests, corrections, déploiement** | Campagne complète, tests de charge, ZAP, build APK signé de test, `docker-compose.prod.yml`, Caddy/TLS, sauvegardes, guides d'installation Windows/Linux, guide de déploiement, coûts récurrents, liste des éléments à obtenir avant production | Rapport de tests réel ; documentation |

Ordre de priorité si le temps doit être réduit : 4 → 5 → 6 → 7 → 8 sont le cœur du MVP ; 9 peut être livré en deux temps (admin minimal : vérifications, réservations, paiements, remboursements, paramètres ; puis le reste).

## 5. Ce qu'il faudra fournir (ou décider) pour avancer

| Élément | Nécessaire pour | Bloquant pour |
|---|---|---|
| Dépôt GitHub (à créer ou rattacher au projet) | Livrer le code | Étape 4 |
| Validation des documents 00 à 06 | Toutes les étapes | Étape 4 |
| Projet Firebase (FCM) | Push réels | Facultatif au MVP (in-app sinon) |
| Fournisseur SMS + identifiant d'expéditeur | OTP réels | Staging et production |
| Prestataire de paiement + compte marchand + clés sandbox | Paiement réel | Production (le développement continue en sandbox interne) |
| Fournisseur de tuiles cartographiques (clé) | Carte en production | Production (tuiles OSM de dev limitées) |
| Avis juridique (CGU, confidentialité, ARTCI, statut « partage de frais ») | Mise en production | Production |
| Valeurs commerciales (commission, frais, plafonds, politiques d'annulation) | Paramétrage | Production (valeurs démo en attendant) |
