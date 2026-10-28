# Étape 7 : réservations

Date : 28 octobre 2026. Statut : **terminée**, à valider.

Cette étape couvre la réservation d'un segment, sans paiement : le paiement (bac à sable interne, webhooks, remboursements effectifs) est l'étape 8, comme prévu dans le plan validé (document 06, §4).

## 1. Fonctionnalités terminées

| Domaine | Ce qui fonctionne réellement |
|---|---|
| Devis | Prix du segment choisi, frais de service, total, places libres sur ce segment, mode d'acceptation et échéance, résumé lisible de la politique d'annulation. Le devis ne bloque aucune place |
| Réservation | Une réservation bloque les places du segment, sous verrou du trajet : deux passagers ne peuvent jamais obtenir la même dernière place. Montants figés à la création. Une même demande rejouée (double appui, reprise réseau) ne crée qu'une réservation. Refus motivés : son propre trajet, trajet non réservable, départ trop proche, trop de places, places insuffisantes (avec le nombre restant), réservation déjà en cours sur ce trajet, plus de 3 demandes en attente, plus de 10 créations par heure, conditions d'annulation non acceptées |
| Acceptation automatique | Places bloquées 15 min en attente de paiement, puis libérées si rien n'arrive. Le paiement mobile n'étant pas encore branché, l'écran le dit et la réservation expire |
| Acceptation manuelle | Demande bloquée jusqu'à l'échéance de réponse (12 h après la demande, et au plus tard 2 h avant le départ) ; impossible à moins de 3 h du départ. Le conducteur accepte (15 min pour payer ensuite) ou refuse (places libérées, motif conservé). Sans réponse, la demande expire ; une acceptation tardive est refusée |
| Espèces | Seulement si la plateforme et le conducteur l'acceptent : la réservation est confirmée, montant à régler au conducteur. **Désactivé par défaut** (paramètre `payments.cash_enabled`) |
| Annulation par le passager | Aperçu du remboursement avant confirmation, puis annulation avec motif. Règles du document 05 §7 : rien payé ou espèces non versées, gratuit ; politique STANDARD (100 %, 50 %, 0 % de la part trajet selon le délai) ; frais de service rendus seulement dans les 15 min suivant la confirmation et à plus de 24 h du départ ; annulation sans frais si l'horaire a été décalé de plus de 30 min ou si le conducteur a plus de 30 min de retard. La part non rendue revient au conducteur, commission déduite |
| Annulation par le conducteur | D'une réservation ou du trajet entier : remboursement intégral (frais de service compris) des réservations payées, demandes en attente annulées, compteur d'annulations sur 90 jours augmenté si des passagers étaient confirmés |
| Jour du trajet | Au départ, les demandes encore en attente expirent. Absence d'un passager signalable 15 min après l'heure de passage prévue. À la fin, les réservations passent à « effectuée » |
| Tâches automatiques | Toutes les minutes (BullMQ) : expiration des blocages et des demandes, clôture d'un trajet 12 h après l'arrivée prévue, annulation d'un trajet jamais démarré 6 h après le départ (passagers remboursés intégralement) |
| Événements | Chaque changement important (réservation créée, acceptée, annulée, remboursement à faire…) est enregistré dans la table `outbox_events`, pour les notifications (étape 9) et le paiement (étape 8). Historique des statuts conservé avec l'auteur (passager, conducteur, automatique) et le motif |
| Cloisonnement | Une réservation n'est visible que de son passager et du conducteur du trajet ; tout autre compte reçoit 404, sans détail. La commission et le montant net ne sont montrés qu'au conducteur ; l'immatriculation au passager seulement une fois la réservation confirmée |
| Écran 8 (Réserver) | Web et mobile : montée, descente et heures estimées, nombre de places, montants, mode d'acceptation et délai, avertissement « paiement mobile pas encore branché », case espèces si permise, conditions d'annulation à accepter. Redirige vers la connexion ou la fin de profil si nécessaire |
| Écran 12 (Mes réservations) | Web et mobile : onglets « À venir » et « Passées », détail avec statut, délai restant, montants, historique, annulation avec aperçu du remboursement |
| Côté conducteur | Gestion d'un trajet (web et mobile) : liste des passagers avec statut, montant net, boutons Accepter, Refuser, Passager absent, Détail et annulation ; demandes expirées, refusées ou annulées repliées. Navigation web : lien « Réservations » |

## 2. Ce qui est simulé, partiel ou non vérifié

| Élément | État |
|---|---|
| Paiement | **Aucun paiement possible** dans cette version : les réservations en attente de paiement expirent. L'étape 8 apporte le bac à sable interne et la couche de paiement interchangeable. Aucune intégration réelle n'est déclarée opérationnelle |
| Remboursements | Calculés et enregistrés (montant dû, statut « remboursement en attente », événement `refund.requested`), **pas exécutés** : rien n'a été encaissé. Les tests posent l'état « payé » directement en base pour vérifier les calculs |
| Commission et frais | Taux lus dans `fee_rules`. **Aucun taux n'est fixé en production** : sans règle, la réservation répond 503 « frais non configurés ». Les données de démonstration et les tests utilisent 10 % de commission et 6 % de frais de service, à titre d'exemple, en attente d'une décision commerciale |
| Notifications | Événements enregistrés seulement ; ni SMS, ni notification sur le téléphone (étape 9) |
| Espèces | Fonctionne et est testé, mais désactivé par défaut. À décider : faut-il des frais de service sur une réservation payée en espèces, et comment les percevoir ? |
| Parcours web dans le navigateur | Fait sur des données de développement ; pour essayer l'acceptation manuelle, j'ai passé un trajet de test en mode manuel par une commande SQL (aucun écran ne change ce mode après publication), et j'ai remis à zéro des limites d'envoi de codes SMS de développement entre deux essais |
| Application mobile | Analysée et testée avec de faux serveurs ; APK compilé par la CI ; **pas essayée sur un téléphone réel** ni contre l'API |

Non fait à cette étape, prévu plus tard :

- annulation partielle (réduire le nombre de places d'une réservation, `seatsToCancel`) : pas encore ;
- codes promotionnels dans le devis : étape 9 ;
- prolongation du blocage pendant un paiement en cours : étape 8 ;
- alerte au conducteur 3 h avant le départ, rappels : étape 9 ;
- consultation et annulation par le personnel (support, administration) : étape 9 ;
- confirmation de présence, partage de trajet, avis : étape 9.

## 3. Écarts par rapport aux documents validés

- Migration `0014` : montants dus (remboursement au passager, part du conducteur), « annulation sans frais », dates d'expiration, de refus et d'absence, contrôle « remboursement ≤ total », trajet clos automatiquement.
- Paramètres ajoutés (modifiables en base) : `booking.max_creations_per_hour` (10), `booking.no_show_delay_minutes` (15), `booking.late_driver_free_cancel_minutes` (30), `booking.manual_min_hours_before_departure` (3), `booking.manual_deadline_hours_before_departure` (2), `trip.auto_close_hours_after_arrival` (12), `trip.auto_cancel_hours_after_departure` (6).
- `POST /bookings` exige `acceptCancellationPolicy: true` : l'acceptation des conditions est vérifiée par le serveur, pas seulement par l'écran.
- Un trajet qui a des réservations peut maintenant être annulé par le conducteur (auparavant refusé en attendant cette étape) ; ses passagers sont remboursés intégralement.
- Le plafond de prix par km reste un paramètre non fixé, donc non appliqué.

## 4. Commandes exécutées (extrait)

```bash
pnpm --filter @ivoirecovoit/backend db:migrate && pnpm --filter @ivoirecovoit/backend db:seed   # 0014, paramètres
pnpm --filter @ivoirecovoit/backend lint / typecheck / test / build
pnpm --filter @ivoirecovoit/web lint / typecheck / test
flutter analyze && flutter test                      # dans apps/mobile
node run7.js                                         # parcours web dans Chromium (Playwright)
```

## 5. Résultats des tests réellement obtenus

| Suite | Résultat |
|---|---|
| Backend (Jest, PostGIS, Redis et stockage S3 réels) | **275 / 275** réussis (35 nouveaux pour les réservations) |
| Web (Vitest) | **47 / 47** réussis, 9 fichiers |
| Mobile (flutter test) | **37 / 37** réussis ; `flutter analyze` : aucun problème |
| Lint et types | backend, web : aucune erreur |
| Contre-épreuve du verrou | En retirant le verrou du trajet, T1 et T1b échouent (survente constatée) : ce sont bien eux qui protègent contre la survente |
| Parcours web dans Chromium | Réservation instantanée, annulation gratuite ; demande sur un trajet à acceptation manuelle, acceptation par le conducteur depuis la gestion du trajet ; mes réservations (à venir, passées) ; largeur de téléphone de 320 à 390 px sans débordement |
| CI GitHub | CI_RESULT |

Tests serveur ajoutés :

- **T1** : deux passagers sur la dernière place, 50 répétitions : à chaque fois exactement un 201 et un 409, trajet complet.
- **T1b** : 10 passagers simultanés, 1 ou 2 places, sur 3 places : jamais de survente (vérifié en base).
- **T1c** : segments disjoints sur la dernière place : les deux passent ; le trajet entier échoue.
- **T4 (partie réservation)** : le conducteur annule un trajet avec 2 réservations payées et 1 demande en attente : remboursements intégraux enregistrés, demande annulée sans remboursement, événements créés, compteur d'annulations +1. Les commissions annulées et le grand livre viendront avec l'étape 8.
- **T5** : un autre compte reçoit 404 sur la lecture, l'acceptation, le refus, l'aperçu et l'annulation, l'absence ; aucun détail dans le message.
- Devis, blocage de 15 min, idempotence, refus, limite de demandes en attente, expiration, mode manuel (acceptation, refus, échéance, trop tard), annulations selon chaque règle, jour du trajet, tâches automatiques, espèces, mes réservations ; calculs de montants et d'annulation (arrondis, bornes, plafonds).

## 6. Problèmes encore présents

- Le taux de commission et les frais de service doivent être fixés commercialement avant toute ouverture.
- La question des frais de service en cas de paiement en espèces est à trancher.
- Restent ouverts des étapes précédentes : fournisseur SMS, textes juridiques (CGU), serveur OSRM et fournisseur de tuiles, plafond de prix par km, essai sur un vrai téléphone.

## 7. Prochaine étape

**Étape 8 : paiement en bac à sable et webhooks** : couche de paiement interchangeable, bac à sable interne (aucun paiement réel sans contrat avec un agrégateur), squelette d'adaptateur pour un agrégateur, webhooks signés, remboursements effectifs, commissions, grand livre, relevés ; tests T2, T3 et T4 complet ; écrans 9 (paiement) et 14 (revenus du conducteur).
