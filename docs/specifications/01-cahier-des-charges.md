# IvoireCovoit : étape 2, cahier des charges fonctionnel et technique

> Statut : proposition à valider. Les identifiants `EF-xx` (exigences fonctionnelles) et `ENF-xx` (non fonctionnelles) sont repris dans le plan de tests.
> Priorité : **M** = MVP, **I2** = incrément 2, **I3** = plus tard.

## 1. Acteurs et rôles

| Rôle | Description | Attribution |
|---|---|---|
| Visiteur | Non connecté : peut rechercher et consulter des trajets (sans données personnelles du conducteur au-delà du prénom, de la note et du véhicule). | — |
| PASSENGER | Tout utilisateur au téléphone vérifié. | Automatique après OTP |
| DRIVER | Utilisateur ayant un profil conducteur **approuvé** et au moins un véhicule **approuvé**. | Après validation admin |
| SUPPORT | Agent : consulte réservations et litiges, répond, ajoute des notes. Ne voit pas les documents d'identité, ne modifie pas les paramètres financiers, ne rembourse pas au-delà d'un plafond. | Par un ADMIN |
| ADMIN | Gère vérifications, suspensions, trajets, remboursements, paramètres, promotions. | Par un SUPER_ADMIN |
| SUPER_ADMIN | Gère les rôles admin et les paramètres sensibles. Compte nominatif, 2FA obligatoire. | Initialisation |

Un utilisateur peut cumuler PASSENGER et DRIVER. Les rôles du personnel (SUPPORT, ADMIN) sont portés par des comptes distincts des comptes utilisateurs ordinaires (recommandé) ou au minimum avec 2FA obligatoire.

## 2. Exigences fonctionnelles

### 2.1 Comptes et authentification

| ID | Exigence | Prio |
|---|---|---|
| EF-01 | Inscription par numéro de téléphone ivoirien (format E.164 `+225` + 10 chiffres) ; e-mail facultatif. | M |
| EF-02 | Vérification du téléphone par OTP à 6 chiffres, validité 5 min, 5 essais max par code, 3 envois max par 15 min et par numéro, 10 par jour, limitation par IP et par appareil. | M |
| EF-03 | Connexion par téléphone + OTP (pas de mot de passe au MVP pour les utilisateurs). Mot de passe + 2FA TOTP obligatoires pour SUPPORT/ADMIN. | M |
| EF-04 | Déconnexion d'un appareil et de tous les appareils ; liste des sessions actives. | M |
| EF-05 | Récupération de compte : par OTP sur le numéro ; en cas de perte du numéro, procédure via support avec vérification manuelle, journalisée. | M |
| EF-06 | Changement de numéro : OTP sur l'ancien **et** le nouveau numéro, ou procédure support. | I2 |
| EF-07 | Connexion par Google / Apple. | I2 |
| EF-08 | Suppression de compte à la demande (anonymisation, conservation légale des données financières). | M |
| EF-09 | Consentements enregistrés et datés : CGU, politique de confidentialité, géolocalisation, marketing. | M |

### 2.2 Profils

| ID | Exigence | Prio |
|---|---|---|
| EF-10 | Profil : prénom, nom (seul le prénom et l'initiale du nom sont publics), photo facultative, bio courte, préférences (fumeur, musique, animaux, discussion), langues parlées. | M |
| EF-11 | Indicateurs de confiance publics : téléphone vérifié, profil conducteur vérifié, note moyenne, nombre de trajets réalisés, ancienneté. | M |
| EF-12 | Contact d'urgence (nom + téléphone) facultatif, privé. | M |

### 2.3 Conducteurs et véhicules

| ID | Exigence | Prio |
|---|---|---|
| EF-20 | Demande « devenir conducteur » : permis de conduire (numéro, date d'expiration, photo recto/verso), pièce d'identité (CNI, passeport ou carte consulaire). | M |
| EF-21 | Véhicule : marque, modèle, couleur, année, immatriculation (format ivoirien vérifié par expression régulière souple), nombre de places passagers autorisées (1 à 8), photo facultative. | M |
| EF-22 | Documents véhicule : carte grise, attestation d'assurance (date d'expiration), visite technique (date d'expiration). | M |
| EF-23 | Documents stockés dans un bucket privé, chiffrés au repos ; téléchargement via URL signée valable 5 minutes, réservée à l'auteur et aux admins habilités ; chaque consultation admin est journalisée avec motif. | M |
| EF-24 | Vérification progressive : niveau 0 (téléphone vérifié) → niveau 1 (identité validée) → niveau 2 (permis + véhicule + assurance validés = peut publier). Rejet motivé avec possibilité de renvoyer. | M |
| EF-25 | Alerte automatique 30 jours avant expiration d'un document ; publication bloquée si assurance ou visite expirée. | M |
| EF-26 | Statut « conducteur professionnel » et abonnement. | I3 |

### 2.4 Trajets

| ID | Exigence | Prio |
|---|---|---|
| EF-30 | Création d'un trajet : origine, destination (lieu du référentiel + adresse/point de rencontre précis avec coordonnées), date et heure de départ, arrêts intermédiaires ordonnés (0 à 5), places offertes (≤ places du véhicule), prix par passager en XOF (entier, multiple de 50, entre un min et un max paramétrables), description, consignes, bagages admis, mode d'acceptation (AUTO/MANUAL), politique d'annulation (choix parmi des politiques définies par l'admin). | M |
| EF-31 | Prix des segments : par défaut prix proportionnel à la distance estimée du segment, arrondi à 50 XOF, modifiable par le conducteur dans les bornes. | M |
| EF-32 | Calcul de la distance et durée estimées via le service de routage, affichées avec la mention « estimation ». | M |
| EF-33 | Statuts : DRAFT, PUBLISHED, FULL, IN_PROGRESS, COMPLETED, CANCELLED (voir doc 05). | M |
| EF-34 | Départ au plus tôt 30 min après la publication (paramétrable), au plus tard 90 jours. | M |
| EF-35 | Modification : libre tant qu'aucune réservation active ; ensuite, seuls description, consignes et ajout de places sont libres. Changement d'heure (> 30 min), de point de rencontre ou de prix : notification des passagers, qui peuvent annuler sans frais ; changement de prix à la hausse interdit pour les réservations existantes. | M |
| EF-36 | Duplication d'un trajet sur plusieurs dates. | M |
| EF-37 | Récurrence réelle (tous les lundis…). | I2 |
| EF-38 | Le conducteur voit la liste des passagers confirmés avec prénom, photo, note, nombre de places, point de montée/descente. | M |
| EF-39 | Démarrage (« Je pars ») et fin (« Trajet terminé ») déclarés par le conducteur ; le passager confirme sa présence ou signale un problème dans les 48 h. | M |

### 2.5 Recherche et carte

| ID | Exigence | Prio |
|---|---|---|
| EF-40 | Saisie assistée des lieux (autocomplétion sur le référentiel villes/communes/quartiers, tolérante aux accents et fautes : « Yamoussokro », « Bassam »). | M |
| EF-41 | Critères : départ, arrivée, date (et plage horaire), nombre de places, prix max, direct uniquement, rayon autour du point du passager (par défaut 5 km en urbain, 15 km en interurbain). | M |
| EF-42 | Un trajet correspond si un point de montée (origine ou arrêt) est proche du départ demandé **et** un point de descente postérieur est proche de l'arrivée. | M |
| EF-43 | Tri : heure de départ, prix, proximité, note du conducteur. | M |
| EF-44 | Affichage liste et carte ; chaque carte de trajet affiche heure, lieux, durée et distance estimées, prix par personne, places restantes, note et prénom du conducteur, véhicule (marque, modèle, couleur), mode d'acceptation. | M |
| EF-45 | La recherche n'exige pas la géolocalisation ; « autour de moi » demande l'autorisation au moment de l'usage. | M |
| EF-46 | Alertes de recherche (« prévenez-moi si un trajet Abidjan–Bouaké est publié »). | I2 |

### 2.6 Réservation

| ID | Exigence | Prio |
|---|---|---|
| EF-50 | Étapes : sélection → détail et conditions → nombre de places (et identité des passagers supplémentaires facultative) → récapitulatif (prix unitaire, sous-total, frais de service, remise, total) → acceptation conducteur si MANUAL → paiement → référence unique `IC-XXXXXX` → notifications. | M |
| EF-51 | Aucune survente : verrouillage transactionnel (doc 05). | M |
| EF-52 | Blocage temporaire des places pendant le paiement (15 min, paramétrable), libération automatique à l'expiration ou à l'échec. | M |
| EF-53 | Mode MANUAL : le conducteur a 12 h (ou jusqu'à 2 h avant le départ) pour accepter ; sans réponse, expiration et notification. Les places sont bloquées pendant ce délai. | M |
| EF-54 | Un passager ne peut pas réserver son propre trajet, ni avoir deux réservations actives sur le même trajet, ni plus de N réservations en attente simultanées (anti-abus). | M |
| EF-55 | Modification du nombre de places : à la baisse = annulation partielle selon la politique ; à la hausse = nouvelle réservation. | M |
| EF-56 | Annulations, retards, absences : règles transparentes affichées avant paiement (doc 05). | M |

### 2.7 Paiements, commissions, revenus

| ID | Exigence | Prio |
|---|---|---|
| EF-60 | Moyens : Wave, Orange Money, MTN MoMo, Moov Money via prestataire ; espèces si activé. Seuls les moyens réellement disponibles chez le prestataire configuré sont affichés. | M (sandbox) |
| EF-61 | Le paiement n'est réussi qu'après confirmation vérifiée du prestataire (webhook signé **ou** interrogation de statut côté serveur). | M |
| EF-62 | Aucun code PIN, mot de passe ou secret Mobile Money n'est saisi dans l'application ; la validation se fait sur le téléphone du payeur (USSD/push opérateur) ou sur la page du prestataire. | M |
| EF-63 | Historique des transactions pour le passager (paiements, remboursements) et pour le conducteur (gains par trajet, commission, net dû, statut de versement). | M |
| EF-64 | Commission et frais de service paramétrables (pourcentage, montant fixe, min, max), versionnés, appliqués à la date de réservation et figés dans la réservation. | M |
| EF-65 | Codes promo : réduction fixe ou en %, plafond, période, nombre d'utilisations globales et par utilisateur, financement par la plateforme (le net conducteur ne baisse pas). | M |
| EF-66 | Relevé des montants dus aux conducteurs, par période, exportable ; versement enregistré avec référence. | M |
| EF-67 | Journal de rapprochement : comparaison quotidienne paiements internes / relevé prestataire, écarts listés pour traitement. | M |
| EF-68 | Abonnements, partenariats. | I3 |

### 2.8 Confiance, sécurité, litiges

| ID | Exigence | Prio |
|---|---|---|
| EF-70 | Évaluation mutuelle (1 à 5 + commentaire) après un trajet COMPLETED, dans les 14 jours, une fois par réservation et par sens ; publiée quand les deux parties ont noté ou après 14 jours. | M |
| EF-71 | Signalement d'un utilisateur, d'un trajet, d'un message ou d'un avis, avec catégorie (comportement dangereux, conduite, harcèlement, fraude, autre) ; catégories graves = priorité haute + alerte admin. | M |
| EF-72 | Litige lié à une réservation (absence, retard important, montant, trajet non effectué) : ouverture par une partie, réponse de l'autre, décision support/admin, remboursement éventuel. | M |
| EF-73 | Partage du trajet avec un proche : lien temporaire (expire 24 h après l'arrivée prévue) montrant trajet, heure, prénom du conducteur, véhicule, immatriculation, statut. | M |
| EF-74 | Bouton urgence : numéros configurables (police 110/111/170, pompiers 180, SAMU 185, à faire valider), appel direct, et envoi d'un SMS/partage au contact d'urgence si disponible. | M |
| EF-75 | Géolocalisation en direct pendant un trajet, avec consentement, visible seulement par les participants et le lien de partage, arrêtée automatiquement à la fin. | I2 |
| EF-76 | Suspension, bannissement, levée de suspension par un admin, motivés et journalisés. | M |

### 2.9 Messagerie et notifications

| ID | Exigence | Prio |
|---|---|---|
| EF-80 | Messagerie limitée aux participants d'une réservation (en attente ou confirmée), texte uniquement, 1 000 caractères, filtrage des numéros de téléphone et liens externes avant confirmation, limite de débit. | M |
| EF-81 | Notifications in-app et push : publication de trajet (confirmation au conducteur), nouvelle réservation, acceptation/refus, paiement confirmé/échoué, rappel 24 h et 2 h avant départ, changement de point de rencontre ou d'horaire, annulation, fin de trajet, demande d'évaluation, remboursement, litige, réponse du support. | M |
| EF-82 | Préférences de notification par catégorie (sauf notifications transactionnelles obligatoires). | M |
| EF-83 | Canaux SMS et WhatsApp derrière la même interface `NotificationChannel`. | I2 |

### 2.10 Administration

| ID | Exigence | Prio |
|---|---|---|
| EF-90 | Tableau de bord : utilisateurs, conducteurs vérifiés, trajets publiés, réservations, volume payé, commissions, remboursements, litiges ouverts (période sélectionnable). | M |
| EF-91 | Gestion des comptes : recherche (téléphone, nom, référence), fiche, suspension, notes internes. Les données sensibles (téléphone complet, documents) sont masquées par défaut et révélées sur demande motivée, journalisée. | M |
| EF-92 | File de vérification des conducteurs, véhicules et documents. | M |
| EF-93 | Gestion des trajets et réservations (annulation administrative avec motif). | M |
| EF-94 | Paiements, remboursements (avec double validation au-delà d'un montant), commissions, relevés conducteurs, rapprochement. | M |
| EF-95 | Litiges et signalements : file, assignation, statut, historique. | M |
| EF-96 | Paramètres : commission, frais de service, plafonds de prix, politiques d'annulation, durées (blocage, acceptation), moyens de paiement actifs, espèces, numéros d'urgence, référentiel des lieux. | M |
| EF-97 | Promotions. | M |
| EF-98 | Statistiques par ville, axe, période, type (urbain/interurbain). Export CSV (protégé contre l'injection de formules). | M |
| EF-99 | Gestion des rôles du personnel et journal d'audit consultable et non modifiable. | M |

## 3. Exigences non fonctionnelles

| ID | Exigence |
|---|---|
| ENF-01 Performance | Recherche p95 < 800 ms côté serveur pour 50 000 trajets publiés ; écran d'accueil mobile utilisable en < 3 s en 3G. |
| ENF-02 Poids | APK < 25 Mo ; réponses API compressées (gzip/br) ; pagination systématique (20 éléments). |
| ENF-03 Réseau instable | Délais d'attente et reprises avec backoff ; clés d'idempotence sur toute création ; cache local des réservations et billets ; messages d'erreur explicites et actions « Réessayer ». |
| ENF-04 Disponibilité | Objectif 99,5 % mensuel au lancement ; sauvegardes PostgreSQL quotidiennes + WAL (PITR 7 jours), test de restauration mensuel. |
| ENF-05 Sécurité | OWASP ASVS niveau 2 comme référence ; HTTPS/TLS 1.2+ ; HSTS ; secrets hors du code ; dépendances scannées en CI. |
| ENF-06 Données personnelles | Minimisation, finalités déclarées, consentements, droits d'accès/rectification/suppression, conservation limitée (doc 03 §6). |
| ENF-07 Accessibilité | Contraste AA, cibles tactiles ≥ 48 dp, tailles de police système respectées, libellés pour lecteurs d'écran. |
| ENF-08 Compatibilité | Android 8.0+ (API 26) ; navigateurs Chrome, Firefox, Safari, Samsung Internet récents ; écrans dès 320 px de large. |
| ENF-09 Observabilité | Logs structurés JSON sans données sensibles, identifiant de corrélation par requête, métriques (Prometheus), alertes sur échecs de paiement et webhooks. |
| ENF-10 Maintenabilité | TypeScript strict, lint, tests en CI, OpenAPI générée, migrations versionnées, ADR pour les décisions. |
| ENF-11 Internationalisation | Toutes les chaînes externalisées (ARB pour Flutter, i18n Next.js) ; montants formatés `12 500 FCFA` ; dates en `fr-CI`. |

## 4. Parcours utilisateurs

### 4.1 Parcours passager : « Aïcha va d'Abidjan (Cocody) à Yamoussoukro samedi »

1. **Bienvenue** : 3 écrans courts (rechercher, réserver, voyager en confiance), bouton « Commencer », lien « J'ai déjà un compte ».
2. **Recherche sans compte** : elle saisit « Cocody » (autocomplétion « Cocody, Abidjan »), « Yamoussoukro », samedi, 1 place. Elle peut affiner : prix max, heure, direct.
3. **Résultats** : liste de trajets triés par heure ; bascule « Carte ». Chaque carte : `07:30 Cocody Riviera 2 → 10:15 Yamoussoukro (env. 2 h 45, env. 240 km)`, `5 000 FCFA`, `2 places`, `Koffi K. ★4,8 (32)`, `Toyota Corolla grise`. Mention « durée et distance estimées ».
4. **Détail du trajet** : carte de l'itinéraire estimé, points de rencontre (avec distance estimée depuis le lieu recherché), arrêts, règles (bagages, non-fumeur), politique d'annulation en clair, mode « Réservation instantanée » ou « Sur acceptation ».
5. **Connexion requise** au moment de réserver : numéro → OTP → prénom et nom → acceptation des CGU. Retour automatique au trajet.
6. **Réservation** : choix du nombre de places, point de montée et de descente (pré-remplis), récapitulatif : `5 000 × 1 = 5 000 FCFA`, `Frais de service 300 FCFA`, `Total 5 300 FCFA` (valeurs de démonstration). Case « J'accepte les conditions d'annulation ».
7. **Si mode manuel** : « Demande envoyée à Koffi. Réponse au plus tard à 19:00. Vos places sont réservées en attendant. » Notification à l'acceptation, puis paiement.
8. **Paiement** : choix du moyen (Wave, Orange Money, MTN MoMo, Moov Money selon disponibilité), numéro payeur pré-rempli, bouton « Payer 5 300 FCFA ». Écran d'attente : « Validez le paiement sur votre téléphone ». Minuteur de 15 min. L'application interroge le statut ; aucune confirmation tant que le serveur n'a pas reçu la preuve du prestataire.
9. **Confirmation** : référence `IC-7K3P9Q`, billet consultable hors ligne, boutons « Contacter le conducteur », « Partager mon trajet », « Ajouter au calendrier ».
10. **Avant le départ** : rappels 24 h et 2 h, éventuel changement de point de rencontre (avec option d'annulation sans frais).
11. **Jour J** : le conducteur déclare le départ ; Aïcha a accès au bouton urgence et au partage.
12. **Arrivée** : le conducteur déclare la fin ; Aïcha reçoit « Comment s'est passé votre trajet ? » ; elle note et commente, ou signale un problème / ouvre un litige.
13. **Historique** : réservations passées, paiements, reçus.

**Parcours alternatifs** : paiement échoué (message clair, réessayer avec un autre moyen tant que le blocage n'a pas expiré) ; réservation expirée (places libérées, message) ; conducteur refuse (aucun débit, suggestions de trajets proches) ; conducteur annule (remboursement intégral automatique, notification) ; passager annule (montant remboursé calculé et affiché avant confirmation).

### 4.2 Parcours conducteur : « Koffi propose Abidjan → Yamoussoukro »

1. **Devenir conducteur** depuis le profil : explication de ce qui est demandé et pourquoi, puis permis, pièce d'identité, véhicule, carte grise, assurance, visite technique (photos prises dans l'application, compressées, envoyées en reprise sur coupure).
2. **Statut de vérification** visible : « En cours d'examen », « À corriger : photo de l'assurance illisible », « Vérifié ».
3. **Publier un trajet** (formulaire en 4 étapes courtes) :
   1. Départ et arrivée (référentiel + point de rencontre précis sur carte, ou adresse texte de repère : « devant la pharmacie Saint-Jean »).
   2. Arrêts intermédiaires (suggérés selon l'axe : Toumodi, Tiébissou…), date et heure.
   3. Places, prix (suggestion basée sur la distance, bornes affichées), bagages, préférences.
   4. Mode d'acceptation, politique d'annulation, récapitulatif, « Publier ».
4. **Réservations** : notification à chaque demande ; en mode manuel, accepter/refuser avec profil du passager (note, trajets réalisés).
5. **Mes trajets** : à venir, en cours, passés ; liste des passagers par trajet, messagerie, modifier, dupliquer, annuler (avec rappel des conséquences : remboursement intégral des passagers, impact sur la fiabilité).
6. **Jour J** : « Je pars » → trajet IN_PROGRESS ; pointage des passagers présents (absent = no-show) ; « Trajet terminé ».
7. **Revenus** : par trajet : brut, commission, net dû, statut du versement ; relevé mensuel.
8. **Évaluations** reçues et données.

### 4.3 Parcours administrateur et support

1. Connexion admin (mot de passe + TOTP) sur le sous-domaine admin.
2. Tableau de bord : indicateurs, alertes (signalements graves, écarts de rapprochement, webhooks en erreur).
3. File de vérification : ouvrir un dossier, demander l'accès au document (motif obligatoire), approuver/rejeter avec motif.
4. Litige : lire l'historique de la réservation, messages des parties, décider (aucun remboursement, partiel, total), justifier ; si remboursement > plafond SUPPORT, validation ADMIN.
5. Paramètres : modifier la commission → nouvelle version, effective à une date, journalisée ; n'affecte pas les réservations existantes.
6. Export CSV des transactions d'une période pour la comptabilité.

## 5. Liste des écrans

Mobile et web partagent les écrans 1 à 16 ; l'écran 17 est web uniquement.

| # | Écran | Points clés |
|---|---|---|
| 1 | Bienvenue | 3 diapositives, passer, choix de langue prévu |
| 2 | Inscription / connexion | Un seul champ téléphone, indicatif +225 fixe au MVP |
| 3 | Vérification OTP | 6 cases, collage automatique, renvoi après 60 s, compte à rebours |
| 4 | Accueil et recherche | Formulaire départ/arrivée/date/places, trajets populaires, réservations à venir |
| 5 | Résultats | Liste/carte, filtres, états vides utiles, chargement squelette |
| 6 | Détail du trajet | Carte, arrêts, conducteur, véhicule, conditions, CTA réserver |
| 7 | Profil conducteur | Badges, note, avis, véhicule, ancienneté |
| 8 | Réservation | Places, montée/descente, récapitulatif, conditions |
| 9 | Paiement | Moyen, numéro payeur, attente de validation, résultat |
| 10 | Publication d'un trajet | Assistant en 4 étapes, brouillon sauvegardé localement |
| 11 | Gestion des trajets conducteur | Onglets, passagers, actions |
| 12 | Mes réservations | À venir / passées, billet, annulation |
| 13 | Notifications | Liste, non lues, liens profonds |
| 14 | Historique des paiements | Paiements, remboursements, gains (conducteur) |
| 15 | Profil et paramètres | Données, préférences, notifications, consentements, sessions, suppression |
| 16 | Aide, réclamations, sécurité | FAQ, signaler, litiges, urgence, partage |
| 17 | Administration | Tableau de bord, vérifications, trajets, réservations, paiements, litiges, signalements, paramètres, promotions, statistiques, audit, rôles |

Les maquettes et le système de design font l'objet de l'étape 4 du livrable demandé (après validation).
