# ADR 0004 : stockage des documents, itinéraires et recherche

Date : 28 octobre 2026. Statut : accepté (étape 6).

## Contexte

L'étape 6 introduit les pièces justificatives des conducteurs et des véhicules (données sensibles), le calcul
d'itinéraire et la recherche de trajets par segment. Le document d'architecture prévoyait MinIO pour le stockage et
OSRM pour les itinéraires.

## Décisions

| Sujet | Choix | Raison |
|---|---|---|
| Stockage | API S3 standard (`@aws-sdk/client-s3`), serveur RustFS 1.0.4 en développement et en CI | Les images MinIO ne sont plus publiées librement ; le code ne dépend que de l'API S3 et fonctionne avec tout service compatible (MinIO, Ceph, stockage d'un hébergeur) |
| Dépôt | URL signée PUT de 5 min, type et taille signés ; le serveur relit ensuite le fichier : taille, type réel d'après les premiers octets, empreinte SHA-256 | Le fichier ne transite pas par l'API ; un fichier différent de celui annoncé est refusé |
| Lecture | URL signée GET de 5 min, seulement pour le propriétaire ou le personnel autorisé (motif obligatoire, journalisé) | Aucun document n'est public ; la consultation par l'administration laisse une trace |
| Sans stockage | `S3_ENDPOINT` absent : 503 `STORAGE_UNAVAILABLE` sur les dépôts, le reste de l'API fonctionne | Pas de faux succès |
| Itinéraires | OSRM si `OSRM_URL` est défini ; sinon ou en cas d'échec, estimation « vol d'oiseau × coefficient » marquée `HAVERSINE_FALLBACK` | L'écran affiche toujours la source ; une estimation n'est jamais présentée comme un tracé réel |
| Prix | Prix cumulé depuis le départ pour chaque arrêt (multiples de 50 XOF) ; bornes min/max et plafond par km lus dans `app_settings` | Un segment a → b vaut p[b] − p[a] ; les bornes restent modifiables sans déploiement (plafond non fixé : non appliqué) |
| Recherche | PostGIS `ST_DWithin` autour des points demandés (5 km en ville, 15 km entre villes par défaut), places libres calculées sur le segment, pagination par curseur | Un passager peut monter et descendre à un arrêt intermédiaire ; la disponibilité est vraie pour son segment seulement |
| Coordonnées publiques | Points arrondis tant que la réservation n'est pas confirmée | Les points précis ne sont donnés qu'aux passagers confirmés |
| Écritures sensibles | En-tête `Idempotency-Key` sur la création et la duplication ; `If-Match` (version) sur la modification | Un double appui ou une reprise réseau ne crée pas deux trajets ; deux modifications concurrentes ne s'écrasent pas |
| Cartes | Leaflet (web) et flutter_map (mobile), tuiles configurables (`NEXT_PUBLIC_TILE_URL`, `TILE_URL`), OpenStreetMap par défaut | La politique d'usage des tuiles OSM interdit un trafic de production important : un fournisseur sous contrat sera nécessaire |

## Conséquences et limites connues

- Les heures de passage aux arrêts et les durées sont des estimations ; elles sont libellées comme telles partout.
- Sans OSRM, les distances sont approximatives (ligne droite corrigée) : à remplacer par un OSRM alimenté avec les
  données OSM de la Côte d'Ivoire avant l'ouverture (`infrastructure/osrm`).
- Le passage automatique d'un trajet à « en cours » ou « terminé » à l'heure prévue n'est pas encore programmé : le
  conducteur le fait lui-même (tâches planifiées prévues avec les réservations).
