# Étape 8 : paiement en bac à sable et webhooks

Date : 28 octobre 2026. Statut : **terminée**, à valider.

Tout paiement de cette version passe par le **bac à sable interne** : aucun argent réel ne circule, aucun compte marchand, aucune clé d'API et aucune intégration réelle ne sont inclus ni déclarés opérationnels. L'adaptateur pour un agrégateur existe, mais c'est un squelette qui refuse de servir.

## 1. Fonctionnalités terminées

| Domaine | Ce qui fonctionne réellement |
|---|---|
| Couche de paiement interchangeable | Interface `PaymentProvider` (initier, interroger le statut, vérifier un webhook, rembourser, lister les opérations pour le rapprochement). Le prestataire est choisi par la configuration (`PAYMENT_PROVIDER`) |
| Bac à sable interne | Wave, Orange Money, MTN MoMo, Moov Money simulés. Page de paiement simulée avec le bandeau « aucun argent réel n'est débité » et les issues : valider, refuser, annuler, expirer, webhook en double, webhooks dans le désordre, validation sans webhook. Webhooks signés (HMAC-SHA256, horodatage, tolérance 5 min). Désactivé en production |
| Adaptateur agrégateur | Squelette seulement : toute opération répond 503 « prestataire non intégré », et l'API refuse de démarrer en production avec lui tant qu'aucune intégration n'est faite |
| Paiement (écran 9) | Choix du moyen, numéro qui paie (mobile ivoirien, masqué ensuite), rappel « on ne vous demandera jamais votre code secret Mobile Money » (aucun code n'est demandé ni stocké), compte à rebours du blocage, attente de validation mise à jour toute seule, résultat confirmé, refusé (nouvel essai) ou reçu trop tard. Le résultat vient toujours du serveur, jamais du retour de la page de l'opérateur. Une demande rejouée ne crée qu'un paiement ; un seul paiement en cours par réservation ; 10 essais par heure au plus |
| Webhooks | Signature vérifiée sur le corps brut ; signature absente, fausse ou trop ancienne : 401, rien appliqué, entrée au journal d'audit. Chaque événement n'est appliqué qu'une fois (doublons et événements anciens ignorés). Montant différent : paiement marqué en écart, réservation non confirmée, alerte |
| Paiement tardif | Paiement en cours à l'échéance : blocage prolongé une fois (10 min, paramètre). Paiement réussi après expiration : réservation réactivée si les places sont encore libres et l'expiration date de moins de 30 min, sinon remboursement intégral automatique (motif « paiement tardif ») |
| Rattrapage | Toutes les minutes : un paiement en attente depuis plus de 30 s sans nouvelles est interrogé chez le prestataire ; les remboursements en attente sont envoyés ; un remboursement refusé est retenté après 10 min (5 échecs au plus, puis traitement manuel signalé) |
| Remboursements effectifs | Annulation par le passager (selon la politique), par le conducteur (intégral, frais de service compris), trajet annulé ou jamais démarré, paiement tardif : remboursement envoyé au prestataire, statut suivi jusqu'au bout, réservation « remboursée » ou « partiellement remboursée ». Plafond en base : jamais plus que le montant payé ; un seul remboursement actif par motif |
| Commissions | Créées à la confirmation (part trajet, commission, net conducteur), ajustées au prorata d'un remboursement partiel, annulées sur un remboursement intégral ; disponibles 48 h après la fin du trajet s'il n'y a pas de réclamation (paramètre `finance.driver_payable_after_hours`) |
| Grand livre | Écritures en partie double pour chaque paiement et remboursement (compte prestataire, dû au conducteur, commission, frais de service, remboursements). L'équilibre de chaque opération est vérifié par la base elle-même |
| Rapprochement | Chaque nuit, pour la veille : comparaison des paiements et remboursements internes avec la liste du prestataire ; écarts signalés (absent chez le prestataire, montant ou statut différent, opération inconnue). Une période déjà rapprochée n'est pas refaite |
| Historique et gains (écran 14) | Onglet « Paiements » : paiements et remboursements du passager avec statut, moyen, motif et référence. Onglet « Mes gains » : part trajet payée, commission, en attente, disponible, déjà versé, et le détail par trajet et par réservation. Relevé par période (`from`, `to`) |
| Web et mobile | Écrans 9 et 14 sur les deux ; bouton Payer ou Suivre le paiement sur le détail de la réservation ; texte du remboursement ; liens « Historique des paiements » (accueil, mes réservations) et « Mes gains » (espace conducteur) |

## 2. Ce qui est simulé, partiel ou non vérifié

| Élément | État |
|---|---|
| Paiement réel | **Aucun.** Il faudra un contrat avec un agrégateur (ou les opérateurs), ses clés et sa documentation pour écrire le vrai adaptateur. Rien n'est prétendu fonctionner au-delà du bac à sable |
| Webhooks de remboursement d'un vrai prestataire | Non écrits : le bac à sable rembourse immédiatement. Le suivi asynchrone viendra avec l'adaptateur réel |
| Versements aux conducteurs | Les gains disponibles sont calculés, mais **aucun versement n'est automatisé** (l'écran le dit). À mettre en place avec le prestataire, après étude des exigences réglementaires ; aucun portefeuille électronique n'est développé |
| Commission et frais | Toujours lus dans `fee_rules` ; les données de démonstration et les tests utilisent 10 % et 6 %, **à titre d'exemple**, en attente d'une décision commerciale |
| Espèces | Toujours désactivé ; pas d'écritures au grand livre pour les espèces tant que la question des frais n'est pas tranchée |
| Promotions | Le calcul du grand livre prévoit une remise, mais les codes promotionnels arrivent à l'étape 9 ; un remboursement partiel avec remise est refusé en attendant de fixer la règle |
| Parcours web dans le navigateur | Fait sur des données de développement. Entre deux essais, j'ai fait expirer des blocages anciens, annulé par SQL 3 réservations de test sur un trajet de démonstration complet (remboursées ensuite automatiquement par la tâche), remis ce trajet en « publié » et effacé des limites d'envoi en Redis |
| Application mobile | Analysée et testée avec de faux serveurs ; **pas essayée sur un téléphone réel** ni contre l'API |

## 3. Écarts par rapport aux documents validés

- Migration `0015` : part des frais de service rendue et motif du remboursement sur la réservation, prolongation unique du blocage, dernière interrogation d'un paiement, date de réussite d'un remboursement, un seul remboursement actif par motif (hors réclamation et décision du personnel), table des opérations du bac à sable.
- Les webhooks sont traités tout de suite, dans la requête, au lieu d'une réponse rapide suivie d'un traitement en file. L'idempotence et les verrous rendent les doublons sans effet ; la file pourra être ajoutée avec un vrai prestataire si ses délais l'exigent.
- Un webhook mal signé n'est pas enregistré comme événement de paiement (pour ne pas laisser n'importe qui remplir la table) ; il laisse une trace dans le journal d'audit.
- Les relevés sont l'historique des opérations et les gains par période, pas encore un document PDF.
- « Promo libérée » dans T3 ne s'applique pas encore (pas de promotions avant l'étape 9).

## 4. Commandes exécutées (extrait)

```bash
pnpm --filter @ivoirecovoit/backend db:migrate        # 0015
pnpm --filter @ivoirecovoit/backend lint / typecheck / test / build
pnpm --filter @ivoirecovoit/web lint / typecheck / test
flutter analyze && flutter test                      # dans apps/mobile
node run8.js                                         # parcours web dans Chromium (Playwright)
```

## 5. Résultats des tests réellement obtenus

| Suite | Résultat |
|---|---|
| Backend (Jest, PostGIS, Redis et stockage S3 réels) | **302 / 302** réussis, 22 fichiers (27 nouveaux : 20 de paiement de bout en bout, 5 de calcul du grand livre, 2 de configuration). Le fichier de paiement relancé 3 fois de plus : stable |
| Web (Vitest) | **53 / 53** réussis |
| Mobile (flutter test) | **44 / 44** réussis ; `flutter analyze` : aucun problème |
| Lint et types | backend, web : aucune erreur |
| Parcours web dans Chromium | Paiement refusé puis nouvel essai, validation sur la page simulée, réservation confirmée, annulation avec remboursement intégral, historique, réservation à acceptation manuelle acceptée par le conducteur puis payée, gains du conducteur ; largeur de téléphone (360 px) sans débordement |
| CI GitHub (28/10/2026) | Commits d94b5de (API), a06be52 (web) et f7731a9 (mobile) : à chaque fois, les 5 tâches réussies (recherche de secrets, backend, web, mobile + APK Android de debug, images Docker) |

Tests serveur ajoutés :

- **T2** : même webhook signé 2 fois en séquence puis 2 fois en parallèle, et 2 webhooks différents simultanés pour le même succès : une seule confirmation, une seule commission, une seule série d'écritures.
- **T2b** : un ancien « en attente » arrivé après le succès est ignoré ; le paiement reste réussi.
- **T2c** : signature absente, fausse ou trop ancienne : 401, rien enregistré ; montant différent : écart signalé, réservation non confirmée.
- **T3** : paiement refusé : réservation toujours en attente, nouvel essai possible puis succès ; à l'échéance, places libérées. Paiement en cours à l'échéance : prolongation unique.
- **T3b** : paiement réussi après expiration et place reprise : remboursement automatique, pas de survente ; place encore libre : réservation réactivée.
- **T3c** : le retour du navigateur ne confirme rien ; seul le statut obtenu par le serveur fait foi. Paiement validé sans webhook : confirmé par la tâche de rattrapage.
- **T4 complet** : le conducteur annule un trajet avec 2 réservations payées et 1 en attente : 2 remboursements intégraux exécutés, commissions annulées, grand livre équilibré, demande annulée sans remboursement.
- Remboursement partiel à 50 % (conducteur et commission au prorata), remboursement refusé puis retenté, gains disponibles 48 h après la fin sauf réclamation, rapprochement (écarts et opération inconnue), page de paiement simulée.

## 6. Problèmes encore présents

- À décider avant toute ouverture : taux de commission et frais de service, frais en cas d'espèces, choix d'un agrégateur de paiement (contrat, clés, documentation) et mode de versement aux conducteurs.
- Restent ouverts des étapes précédentes : fournisseur SMS, textes juridiques (CGU), serveur OSRM et fournisseur de tuiles, plafond de prix par km, essai sur un vrai téléphone.

## 7. Prochaine étape

**Étape 9 : administration, notifications, réclamations** : tableau de bord, vérifications, gestion des trajets, réservations, paiements et remboursements, litiges et signalements, paramètres versionnés (dont commission et frais), promotions, statistiques, export CSV, journal d'audit, rôles ; notifications dans l'application et sur le téléphone ; messagerie, partage de trajet, urgence, avis ; test T6 ; écrans 13, 16 et 17.
