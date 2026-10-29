# À obtenir et décider avant la production

État au 29 octobre 2026. Tant que les éléments **bloquants** manquent, l'API refuse de démarrer en production
(contrôle au démarrage, `apps/backend/src/config/env.ts`) : seule une pré-production est possible.

## Bloquant : intégrations à contractualiser puis à développer

| Élément | À obtenir | Travail restant ensuite |
|---|---|---|
| **Fournisseur SMS** | contrat, identifiant d'expéditeur (nom affiché) enregistré auprès des opérateurs, accès API, tarifs | adaptateur SMS (l'interface existe), essais sur Orange, MTN et Moov |
| **Agrégateur de paiement Mobile Money** (Wave, Orange Money, MTN MoMo, Moov Money) | compte marchand, contrat, clés de test puis de production, documentation des webhooks, grille de frais, délais de règlement | adaptateur réel à la place du squelette (`PAYMENT_PROVIDER=aggregator`), vérification des signatures, essais de bout en bout avec de petits montants réels, rapprochement sur les relevés du prestataire |
| **Versements aux conducteurs** | mode de versement (API de transfert du prestataire ou manuel), frais, plafonds | automatisation éventuelle ; aujourd'hui marqués « versés » à la main avec une référence externe. Pas de portefeuille électronique sans étude réglementaire (BCEAO) |

## Bloquant : décisions commerciales

- Taux de commission et frais de service (les valeurs de démonstration 10 % et 6 % ne sont pas validées).
- Plafond de prix par kilomètre.
- Frais en cas de paiement en espèces (aujourd'hui désactivé).
- Plafonds de remboursement par rôle (démonstration : 5 000 FCFA pour le support, double validation au-delà de
  10 000 FCFA).
- Promotions de lancement éventuelles.

## Bloquant : juridique et conformité

- CGU, politique de confidentialité et conditions d'annulation rédigées ou relues par un juriste (les textes
  actuels sont des brouillons `0.1-brouillon`).
- Formalités auprès de l'ARTCI (protection des données personnelles) ; lieu d'hébergement des données.
- Statut juridique de la plateforme (intermédiaire de transport), assurance, conditions d'acceptation des
  conducteurs (permis, carte grise, assurance, visite technique) validées.
- Numéros d'urgence officiels confirmés (affichés « à valider »).

## Technique

| Élément | État |
|---|---|
| Nom de domaine, serveur, DNS | à acheter ; guide prêt ([deploiement.md](deploiement.md)) |
| Fournisseur de tuiles de carte sous contrat | à choisir (voir [couts-recurrents.md](couts-recurrents.md)) |
| Serveur OSRM (itinéraires routiers) | script prêt (`infrastructure/osrm/prepare.sh`), à faire tourner ; sinon estimations à vol d'oiseau, signalées comme telles |
| Coordonnées du référentiel de lieux | approximatives : à vérifier sur OpenStreetMap |
| Projet Firebase (notifications sur le téléphone) | à créer ; code écrit mais jamais essayé |
| Clé de publication Android et compte Google Play | à créer ([apk-android.md](apk-android.md)) |
| Stockage S3 des documents chiffré, versionné et sauvegardé | à choisir (externe ou profil `storage` + sauvegarde du volume) |
| Copie des sauvegardes hors serveur | profil `offsite` prêt ; destination et identifiants rclone à fournir |
| Surveillance et alertes (disponibilité, disque, échecs de paiement) | à mettre en place |
| Essais sur de vrais téléphones Android d'entrée de gamme, en 3G | jamais faits |
| Audit de sécurité externe (test d'intrusion) | conseillé ; l'analyse ZAP automatisée de l'étape 10 ne le remplace pas |
| Nouveaux tests de charge sur le serveur réel | à refaire : les mesures de l'étape 10 sont sur une machine de développement |

## Comptes et accès à créer

Comptes du personnel (un par personne, rôle minimal nécessaire), coffre de mots de passe partagé pour
`.env.prod` et la clé Android, accès SSH par clé, accès aux tableaux de bord du prestataire de paiement et du
fournisseur SMS, adresse e-mail d'exploitation (Let's Encrypt, alertes).
