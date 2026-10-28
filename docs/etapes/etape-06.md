# Étape 6 : conducteurs, véhicules, trajets et recherche

Date : 28 octobre 2026. Statut : **terminée**, à valider.

## 1. Fonctionnalités terminées

| Domaine | Ce qui fonctionne réellement |
|---|---|
| Dossier conducteur | Permis (numéro, dates) et pièces obligatoires (permis recto et verso, pièce d'identité : CNI, passeport ou carte consulaire), envoi pour vérification. États : en préparation → soumis → validé ou refusé (motif affiché, corrigeable et renvoyable). Seul un conducteur validé peut publier |
| Véhicules | Ajout, modification, suppression ; immatriculation contrôlée et unique ; carte grise, assurance et visite technique obligatoires (avec dates d'expiration), photo facultative. Publication refusée si l'assurance ou la visite expire avant la date du trajet. Validation séparée de celle du conducteur ; un véhicule modifié sur un point sensible repasse en vérification |
| Pièces justificatives | Dépôt direct dans le stockage privé par URL signée de 5 min ; le serveur vérifie ensuite taille, type réel du fichier et empreinte SHA-256. Aucun document public. Consultation par le personnel avec permission `documents.view` et motif obligatoire, journalisée |
| Vérification (API) | File d'attente, détail d'un dossier, validation ou refus avec motif, par le personnel autorisé ; journal d'audit. L'écran d'administration arrive à l'étape 9 |
| Photo de profil | Dépôt contrôlé (JPEG, PNG ou WebP, 5 Mo), affichage par URL signée temporaire, suppression |
| Lieux | Autocomplétion, lieu le plus proche d'un point, axes populaires calculés sur les trajets publiés |
| Itinéraire | OSRM s'il est configuré ; sinon estimation à vol d'oiseau, **toujours signalée comme telle** à l'écran. Heures de passage aux arrêts estimées, libellées « estimées » |
| Publication | Assistant en 4 étapes (itinéraire et arrêts, véhicule et places, prix, vérification) sur le web et le mobile ; brouillon gardé 14 jours sur l'appareil seulement. Prix suggéré d'après la distance, prix par arrêt répartis au prorata puis modifiables ; bornes 500 à 30 000 FCFA, multiples de 50 (paramètres en base, modifiables). Une même demande rejouée ne crée pas deux trajets |
| Gestion des trajets | « Mes trajets » (à venir, passés, brouillons) ; publier, modifier (places, description, consignes, avec protection contre deux modifications simultanées), dupliquer, annuler avec motif, démarrer, terminer. Un conducteur ne peut pas avoir deux trajets qui se chevauchent, même avec deux véhicules |
| Recherche | Par lieu de départ et d'arrivée (rayon 5 km en ville, 15 km entre villes), date facultative, nombre de places ; trajets qui passent par les deux points dans le bon ordre, prix et places **du segment demandé**. Tri (départ, prix, proximité, note), filtres (prix maximum, direct), pagination |
| Détail d'un trajet | Choix de la montée et de la descente parmi les arrêts, prix et places recalculés, carte, arrêts, conducteur, véhicule, bagages, conditions. Coordonnées arrondies tant que la réservation n'est pas confirmée. Bouton « Réserver » visible mais inactif (étape 7) |
| Profil public du conducteur | Prénom et initiale, photo, badge vérifié, note et nombre d'avis, trajets effectués, véhicules validés, prochains trajets |
| Écrans | Web et mobile : accueil avec recherche (4), résultats en liste ou carte (5), détail (6), profil conducteur (7), publication (10), mes trajets et gestion (11), espace conducteur (permis, pièces, véhicules) |
| Données de démonstration | 50 lieux de référence, 7 comptes, 4 véhicules, 6 trajets, tous marqués `[DEMO]`. Les numéros de démonstration ne peuvent pas se connecter |

## 2. Ce qui est simulé, partiel ou non vérifié

| Élément | État |
|---|---|
| Stockage des fichiers | RustFS (compatible S3) en développement et en CI à la place de MinIO, dont les images ne sont plus publiées librement. Le code n'utilise que l'API S3 : un stockage d'hébergeur conviendra en production (voir ADR 0004) |
| Itinéraires OSRM | **Pas exécuté ici** (il faut préparer les données OSM de la Côte d'Ivoire, plusieurs Go). Tous les essais ont utilisé l'estimation de repli ; le client OSRM est testé contre un faux serveur |
| Fonds de carte | Tuiles OpenStreetMap par défaut, **non affichées dans mes essais** (réseau du bac à sable fermé) : les tracés et points s'affichent, le fond reste gris. En production, la politique d'OSM impose un fournisseur de tuiles sous contrat |
| Validation des dossiers | Fonctionne dans l'API et est testée ; dans mes essais du parcours web, la validation a été faite par une commande SQL de développement, faute d'écran d'administration (étape 9) |
| Réservation, paiement | Étape 7. Le bouton « Réserver » est inactif, avec une explication |
| Annulation avec passagers | Les règles de remboursement et de prévenance des passagers arrivent avec les réservations (étape 7). Dès qu'un trajet a des réservations, ses arrêts sont figés et ses places ne peuvent pas descendre sous le nombre réservé |
| Passage automatique « en cours » / « terminé » | Pas encore programmé : le conducteur le fait lui-même |
| Documents des comptes de démonstration | Enregistrés sans fichier |
| Application mobile | Analysée, testée, APK compilé par la CI ; **pas essayée sur un téléphone réel** |

## 3. Écarts par rapport aux documents validés

- Migration `0013` : états des dossiers conducteur et véhicule, documents (empreinte, taille, type vérifiés), machine à états des trajets, version pour le verrou optimiste, interdiction des trajets qui se chevauchent pour un même conducteur, fonction d'occupation par segment.
- Routes ajoutées au contrat : `POST /trips/preview` (aperçu itinéraire et prix avant publication), `POST /vehicles/:id/documents/:documentId/complete`, `POST /drivers/me/documents/:id/complete`, `POST /me/photo/upload-url` + `POST /me/photo/complete` + `DELETE /me/photo` (dépôt direct au lieu d'un envoi multipart à l'API), `POST /admin/documents/:id/download-url` (motif obligatoire).
- Paramètres ajoutés : `trip.price_min_xof`, `trip.price_max_xof`, `trip.suggested_price_xof_per_km`, `trip.price_cap_xof_per_km` (plafond « partage de frais » non fixé, donc non appliqué, en attente d'une décision commerciale).
- Choix techniques : `docs/adr/0004-stockage-itineraires-et-recherche.md`.

## 4. Commandes exécutées (extrait)

```bash
pnpm --filter @ivoirecovoit/backend add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
pnpm --filter @ivoirecovoit/backend db:migrate && pnpm --filter @ivoirecovoit/backend db:seed   # 0013, lieux, démo
docker compose -f infrastructure/docker-compose.yml --profile storage up -d storage             # RustFS
pnpm --filter @ivoirecovoit/backend lint / typecheck / test / build
pnpm --filter @ivoirecovoit/web add leaflet && pnpm --filter @ivoirecovoit/web lint / typecheck / test / build
flutter pub add flutter_map latlong2 image_picker crypto
flutter analyze && flutter test                      # dans apps/mobile
node run.js                                          # parcours web complet dans Chromium (Playwright)
```

## 5. Résultats des tests réellement obtenus

| Suite | Résultat |
|---|---|
| Backend (Jest, PostGIS, Redis et stockage S3 réels) | **240 / 240** réussis |
| Web (Vitest) | **41 / 41** réussis, 8 fichiers |
| Mobile (flutter test) | **29 / 29** réussis ; `flutter analyze` : aucun problème |
| Lint et types | backend, web : aucune erreur |
| APK Android | Compilé par la CI (pas de SDK Android dans mon environnement) : réussi |
| Parcours web dans Chromium | Recherche, liste, carte, détail, profil conducteur ; connexion, profil ; dossier conducteur et pièces, véhicule et pièces ; validation ; publication en 4 étapes ; gestion ; mes trajets ; photo ; résultats en largeur de téléphone |
| CI GitHub (28/10/2026, commit 20e6b4a) | Les 5 tâches réussies : recherche de secrets, backend (PostGIS, Redis, stockage S3), web, mobile + APK Android de debug, images Docker |

Tests serveur ajoutés :

- **Conducteurs et véhicules** : parcours complet jusqu'à la publication possible ; refus motivé, correction et renvoi ; dossier incomplet ; fichier réellement reçu vérifié (absent, empreinte, type, taille) ; documents cloisonnés (autre utilisateur, rôle SUPPORT) ; immatriculation unique, nouvel examen après modification ; pièce renouvelée examinée seule ; profil public caché tant que non vérifié ; photo de profil.
- **Trajets** : aperçu (itinéraire, horaires, prix suggéré) ; brouillon idempotent puis publication ; publication refusée (conducteur ou véhicule non vérifié, assurance ou visite expirée, départ trop proche ou trop lointain, trop de places, chevauchement, prix invalides, arrêts hors du pays ou trop proches) ; modification avec If-Match ; arrêts figés quand il y a des réservations ; trajet d'un autre conducteur introuvable ; duplication ; démarrage, fin, annulation ; coordonnées arrondies et immatriculation cachée pour le public ; disponibilité par segment ; machine à états.
- **Recherche** : arrêt intermédiaire, ordre des arrêts, prix du segment, filtres, tris, places par segment, rayon urbain, autres axes, fautes de frappe, pagination, trajets imminents exclus, validation des paramètres, axes populaires.
- **Itinéraire et prix** : OSRM (avec cache), repli sans OSRM ou sans route, pause après panne, réponse incohérente rejetée ; arrondi à 50 FCFA, répartition, bornes, plafond par km appliqué seulement s'il est fixé.

## 6. Problèmes encore présents

- Il faut un fournisseur de tuiles de carte et un serveur OSRM préparé avant l'ouverture.
- Le plafond de prix par km (« partage de frais ») reste à décider commercialement.
- Les problèmes de l'étape 5 restent ouverts : fournisseur SMS, textes juridiques, coordonnées des lieux à vérifier sur le terrain.

## 7. Prochaine étape

**Étape 7 : réservations** : réservation d'un segment avec blocage des places, acceptation par le conducteur, expiration, annulations selon les règles validées, absences ; écrans 8 et 12. Le paiement (couche interchangeable, bac à sable interne, remboursements effectifs) est l'étape 8. *(Corrigé le 28/10/2026 : la première version de ce rapport rattachait par erreur le paiement à l'étape 7.)*
