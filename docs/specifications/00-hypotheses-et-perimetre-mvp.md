# IvoireCovoit : étape 1, analyse, hypothèses et périmètre du MVP

> Statut : **proposition à valider**. Aucun code n'est produit à ce stade.
> Nom provisoire : IvoireCovoit. Devise : XOF (franc CFA BCEAO). Langue initiale : français.

## Sommaire des documents de l'étape 1 à 3

| Fichier | Contenu |
|---|---|
| `00-hypotheses-et-perimetre-mvp.md` | Ce document : hypothèses, limites, arbitrages, points à valider |
| `01-cahier-des-charges.md` | Exigences fonctionnelles et non fonctionnelles, parcours passager, conducteur, admin |
| `02-architecture.md` | Architecture générale, choix techniques, structure du dépôt, sécurité |
| `03-schema-base-de-donnees.md` | Modèle relationnel complet (DDL PostgreSQL/PostGIS), contraintes, index, conservation |
| `04-contrats-api.md` | Principaux endpoints REST, conventions, erreurs, permissions |
| `05-regles-reservation-et-paiement.md` | Machines à états, anti-survente, idempotence, annulations, remboursements, commissions |
| `06-plan-de-tests-et-plan-mvp.md` | Plan de tests (dont les 6 cas imposés) et plan de développement étapes 4 à 10 |

---

## 1. Lecture du besoin

Le besoin décrit un produit complet (mobile, web, admin, paiements, litiges, notifications). Le livrer d'un bloc serait risqué : trop de surfaces, et la partie paiement dépend de contrats que le projet ne possède pas encore. Nous proposons donc un **MVP vertical** : un parcours complet et réellement fonctionnel « publier → rechercher → réserver → payer (sandbox) → voyager → évaluer », avec l'administration minimale pour le faire tourner en sécurité, puis des incréments.

## 2. Hypothèses de travail

Ces hypothèses orientent la conception. Chacune peut être corrigée sans remettre en cause l'architecture.

| # | Hypothèse | Conséquence si elle est fausse |
|---|---|---|
| H1 | Le covoiturage est un **partage de frais** entre particuliers, pas une activité de transport rémunéré. Le prix par passager est plafonné par la plateforme (paramétrable). | Si des conducteurs professionnels sont visés, un statut et des documents spécifiques (licence de transport, assurance professionnelle) sont nécessaires. Prévu en option (`driver_profiles.is_professional`), désactivé au MVP. |
| H2 | Le marché prioritaire est **interurbain au départ d'Abidjan** (Yamoussoukro, Bouaké, Daloa, San Pedro, Grand-Bassam…). L'urbain (entre communes d'Abidjan) est supporté par le même modèle mais n'est pas optimisé (pas de trajets « à la demande »). | Un usage urbain intensif demanderait de l'appariement en temps réel, hors MVP. |
| H3 | Les utilisateurs ont surtout des **smartphones Android d'entrée et milieu de gamme**, avec une connexion 3G/4G instable et des forfaits data limités. | Choix : application Flutter légère, cache local, images compressées, cartes chargées à la demande. |
| H4 | Le paiement passera par **un agrégateur agréé** (par exemple CinetPay, PayDunya, Paystack/Flutterwave selon disponibilité en Côte d'Ivoire) plutôt que par des intégrations directes avec chaque opérateur. | L'architecture `PaymentProvider` permet d'ajouter des adaptateurs directs (Wave, Orange Money…) plus tard. **Aucun prestataire n'est choisi ni contractualisé à ce jour.** |
| H5 | La plateforme **ne détient pas de fonds** au sens d'un portefeuille électronique. Les fonds encaissés transitent chez l'agrégateur ; les reversements aux conducteurs sont faits par l'agrégateur (payout) ou manuellement par l'opérateur de la plateforme sur la base du relevé. | Un portefeuille interne exigerait un statut d'établissement de paiement ou de monnaie électronique (BCEAO). Exclu du MVP. |
| H6 | Le **paiement en espèces** est un mode optionnel, activable par l'admin. Dans ce mode, la plateforme n'encaisse rien ; seule la réservation est confirmée, et la commission éventuelle est facturée au conducteur hors application. | Si l'admin le désactive, seul le Mobile Money est proposé. |
| H7 | L'OTP SMS passe par un **fournisseur SMS** (à choisir : Twilio Verify, Orange SMS API, un agrégateur local…). En développement, un mode test affiche le code dans les logs serveur, **jamais activable en production**. | Pas de compte SMS = pas d'inscription en production. Élément bloquant à obtenir. |
| H8 | La cartographie MVP utilise **OpenStreetMap** (tuiles) et **OSRM** auto-hébergé pour le routage, avec une liste de lieux de référence (villes, communes, quartiers) chargée en base. | Google Maps reste possible via un adaptateur ; coût par requête à évaluer. |
| H9 | La loi ivoirienne n° 2013-450 relative à la protection des données personnelles et l'**ARTCI** s'appliquent (déclaration ou autorisation de traitement, notamment pour les pièces d'identité et la géolocalisation). | Démarche à faire valider par un juriste avant production. |
| H10 | Une seule équipe d'exploitation, un seul pays, un seul fuseau horaire (`Africa/Abidjan`, UTC+0, sans heure d'été). Les dates sont stockées en UTC. | L'extension à d'autres pays d'Afrique de l'Ouest est préparée par les champs `country_code` et `currency` mais non activée. |

## 3. Arbitrages proposés pour réduire coût et complexité

Ces arbitrages respectent la contrainte « ne pas compromettre paiements, sécurité, intégrité des réservations ».

1. **Un seul backend NestJS modulaire (monolithe modulaire)**, pas de microservices. Les modules (auth, trips, bookings, payments…) ont des frontières nettes, ce qui permet d'en extraire un plus tard.
2. **Une seule application Next.js** pour le web public et l'administration (`/admin`), avec des rôles et un layout séparés. L'admin est servie sous un sous-domaine distinct en production (`admin.`) pour isoler cookies et politique CSP.
3. **Pas de broker de messages** au MVP : les tâches asynchrones (expiration des réservations, rappels, envoi des notifications, rapprochement) passent par une file **BullMQ sur Redis**. Redis sert aussi au rate limiting et aux OTP.
4. **Messagerie** : au MVP, messagerie texte simple liée à une réservation confirmée (pas de temps réel WebSocket ; rafraîchissement par polling + push). Les numéros de téléphone ne sont jamais échangés par l'application.
5. **Suivi en temps réel** : au MVP, le conducteur déclare « départ » et « arrivée ». Le partage de position en direct est une fonctionnalité de l'incrément 2, avec consentement explicite. Le partage avec un proche se fait par **lien temporaire** affichant les informations du trajet (pas la position GPS au MVP).
6. **Trajets récurrents** : au MVP, le conducteur peut **dupliquer** un trajet sur plusieurs dates ; un vrai modèle de récurrence (règles RRULE) vient plus tard.
7. **iOS** : le code Flutter est commun, mais seul le build Android est vérifié au MVP ; le build iOS nécessite un Mac et un compte Apple Developer.

## 4. Périmètre du MVP

### Inclus et réellement fonctionnel (hors dépendances externes)

- Inscription et connexion par téléphone + OTP ; e-mail facultatif ; sessions par jetons (accès court + rafraîchissement rotatif).
- Rôles PASSENGER, DRIVER, SUPPORT, ADMIN (plus SUPER_ADMIN technique) avec permissions fines côté serveur.
- Profil, photo facultative, devenir conducteur, ajout de véhicule, dépôt de documents dans un stockage privé, validation par l'admin.
- Publication de trajet avec arrêts intermédiaires, points de rencontre, prix par segment simplifié (voir règles), mode d'acceptation automatique ou manuel, duplication sur plusieurs dates.
- Recherche par lieu de départ/arrivée (ville, commune, quartier), date, places, prix max, direct ou avec arrêts, proximité d'un point de rencontre.
- Réservation avec verrouillage des places, expiration de la réservation temporaire, acceptation manuelle, référence unique.
- Paiement via **adaptateur sandbox** interne (simule un prestataire avec webhooks signés) et squelette d'adaptateur pour un agrégateur réel, non connecté.
- Annulations passager et conducteur, absences, remboursements (calcul et suivi ; exécution réelle dépendante du prestataire).
- Commissions et frais de service paramétrables, relevé des montants dus aux conducteurs, journal de rapprochement.
- Évaluations après trajet terminé, signalements, litiges, journal d'audit.
- Notifications in-app + push FCM (si projet Firebase fourni) ; interface prête pour SMS/WhatsApp.
- Tableau de bord admin : utilisateurs, vérifications, trajets, réservations, paiements, litiges, signalements, paramètres, promotions simples, statistiques, export CSV, audit.
- Partage du trajet avec un proche (lien temporaire) et écran urgence avec numéros configurables.

### Simulé ou mode développement, clairement identifié

| Élément | Mode MVP | Ce qu'il faut pour le rendre réel |
|---|---|---|
| Paiement Mobile Money | Adaptateur `SandboxPaymentProvider` : page de paiement factice, webhooks signés HMAC envoyés par un simulateur. Bandeau « SANDBOX » visible dans toutes les interfaces. **Refus de démarrage si `PAYMENT_PROVIDER=sandbox` et `NODE_ENV=production`.** | Contrat avec un agrégateur, compte marchand, clés API, URL de webhook validée |
| OTP SMS | Code affiché dans les logs + code fixe `000000` accepté **uniquement si `OTP_TEST_MODE=true` et environnement ≠ production** (le serveur refuse de démarrer sinon) | Compte fournisseur SMS, identifiant d'expéditeur (sender ID) validé |
| Push | FCM réel si un projet Firebase est fourni, sinon notifications in-app seulement | Projet Firebase, fichier de service account |
| Stockage documents | MinIO local (compatible S3) | Bucket privé chez un fournisseur cloud |
| Routage | OSRM auto-hébergé avec l'extrait OSM Côte d'Ivoire ; à défaut, distance à vol d'oiseau × coefficient, **affichée comme « estimation approximative »** | Serveur OSRM en production (ou API payante) |
| Remboursement | Calcul, statut et ordre de remboursement enregistrés ; exécution réelle par l'API du prestataire si elle le permet, sinon procédure manuelle tracée | API de remboursement ou de payout du prestataire |
| Données de démonstration | Utilisateurs, véhicules et trajets fictifs préfixés `[DEMO]`, numéros en `+225 00 00 00 xx` (plage non attribuée), chargés par un script `seed` séparé, jamais en production | — |

### Hors MVP (incréments suivants)

- Suivi GPS en direct partagé avec un proche.
- Messagerie temps réel (WebSocket), envoi de photos.
- Connexion par compte Google/Apple (« compte compatible »), prévue dans le modèle (`auth_identities`).
- Abonnements conducteurs professionnels, partenariats, programme de parrainage.
- SMS et WhatsApp transactionnels (en plus de l'OTP).
- Mode sombre (l'architecture du thème le prévoit).
- Mode hors ligne avancé (consultation des billets hors ligne : oui au MVP ; création hors ligne : non).
- Multi-pays, multi-devises, multi-langues (dioula, anglais).
- Portefeuille, crédit, cagnotte.
- Vérification d'identité automatisée (KYC par prestataire).

## 5. Limites et risques connus

| Risque | Impact | Mitigation |
|---|---|---|
| Aucun contrat de paiement à ce jour | Pas d'encaissement réel | Architecture interchangeable + sandbox ; liste des prestataires à consulter en étape 17-18 |
| Cadre réglementaire du covoiturage rémunéré peu explicite | Requalification en transport public | Plafond de prix par km paramétrable, CGU « partage de frais », avis juridique avant lancement |
| Fraude (faux conducteurs, faux paiements, no-show) | Perte de confiance | Vérification progressive, paiement confirmé uniquement par webhook vérifié, notation, signalements, limites de réservation par compte |
| Données géographiques locales incomplètes (quartiers, points de repère) | Recherche imprécise | Référentiel de lieux maintenu par l'admin, saisie libre du point de rencontre + coordonnées sur carte |
| Connexions instables | Doubles soumissions, paiements « perdus » | Clés d'idempotence, statuts consultables, rapprochement automatique par interrogation du prestataire |
| Sécurité physique des usagers | Grave | Partage du trajet, urgence, signalements prioritaires, suspension rapide |

## 6. Points à valider par vous avant l'étape 4

Merci de confirmer ou corriger chacun de ces points (une réponse courte suffit, par exemple « OK sauf 3 : … »).

1. **Périmètre MVP** tel que décrit en section 4.
2. **Monolithe modulaire NestJS + une seule app Next.js (web + admin)** plutôt que des applications séparées.
3. **OpenStreetMap + OSRM** au MVP plutôt que Google Maps.
4. **Agrégateur de paiement** comme cible principale (à choisir plus tard), sandbox interne en attendant.
5. **Paiement en espèces** : activable par l'admin, désactivé par défaut. À confirmer.
6. **Politique d'annulation par défaut** proposée dans `05-regles-reservation-et-paiement.md` (valeurs paramétrables, aucune n'est définitive).
7. **Commission** : aucun taux imposé ; les valeurs de démonstration (par exemple 10 %) seront marquées comme telles.
8. **Ordre des incréments** décrit dans `06-plan-de-tests-et-plan-mvp.md`.
9. Où héberger le code : un dépôt GitHub à créer ou à rattacher au projet (nécessaire à partir de l'étape 4).
