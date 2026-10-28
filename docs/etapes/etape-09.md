# Étape 9 : administration, notifications, confiance

Date : 28 octobre 2026. Statut : **terminée**, à valider.

Les paiements passent toujours uniquement par le **bac à sable interne**. Aucune clé (SMS, FCM, prestataire), aucun compte marchand et aucune intégration réelle ne sont inclus ni déclarés opérationnels. Les montants et seuils cités ci-dessous (plafonds de remboursement, taux de démonstration) sont **des valeurs d'exemple paramétrables**, en attente de décision.

## 1. Fonctionnalités terminées

| Domaine | Ce qui fonctionne réellement |
|---|---|
| Console d'administration (web, `/admin`) | Connexion du personnel par e-mail, mot de passe et code TOTP ; cookies, relais et jeton anti-CSRF **séparés** de ceux des utilisateurs (session de 12 h) ; le relais des utilisateurs ne peut pas atteindre `/admin`. Menu filtré selon les droits ; page refusée affichée « Vous n'avez pas accès » |
| Rôles (T6) | SUPPORT, ADMIN, FINANCE, SUPER_ADMIN avec permissions détaillées. Chaque refus d'accès est inscrit au journal d'audit. Écran du personnel : création (secret TOTP montré une seule fois), rôles, activation |
| Tableau de bord (écran 17) | Indicateurs du jour, files à traiter (vérifications, signalements, réclamations, remboursements à valider, écarts de rapprochement) |
| Vérifications et utilisateurs | Pièces et permis à valider ou refuser avec motif ; consultation d'une pièce **justifiée et journalisée** ; suspension, bannissement, réactivation avec motif ; notes internes du personnel (jamais visibles des utilisateurs) |
| Trajets et réservations | Recherche, fiche, annulation par l'administration avec motif (remboursements intégraux déclenchés), historique |
| Paiements et remboursements | Liste et fiche d'un paiement avec ses événements ; nouvelle interrogation du prestataire. Remboursement décidé par le personnel avec note ; plafond pour SUPPORT et **double validation** au-delà d'un seuil (le demandeur ne peut pas valider lui-même, contrainte en base) ; refus motivé |
| Finance | Commissions par statut, préparation des versements aux conducteurs jusqu'à une date, marquage « versé » avec référence externe, annulation ; rapprochement lancé à la main, écarts à résoudre ; exports CSV (transactions, réservations, remboursements, commissions) |
| Réclamations (litiges) | Ouverture par le passager ou le conducteur jusqu'à 7 jours après le trajet, réponse attendue de l'autre partie, gains du conducteur bloqués pendant le litige. Côté console : prise en charge, messages publics ou internes, consultation de la conversation des parties (journalisée), décision (pas de remboursement, remboursement partiel ou intégral, pénalité conducteur, rejet) |
| Signalements | Par les utilisateurs (personne, trajet, message, avis), gravité déduite de la catégorie ; côté console : prise en charge, masquage d'un message ou d'un avis, clôture « mesure prise » ou « classé », réouverture |
| Paramètres versionnés | Groupés par section, chaque modification exige un motif et garde l'historique. Règles de frais en versions datées ; **aucun pourcentage proposé par défaut** dans le formulaire ; valeurs de démonstration marquées [DEMO] |
| Promotions | Création (code, remise fixe ou en %, plafond, période, « premier trajet »), désactivation. Remise sur la part trajet ; le code est réservé avec la réservation, consommé au paiement, libéré si la réservation n'aboutit pas ; écriture « dépense promotionnelle » au grand livre, le conducteur touche le prix entier |
| Lieux, statistiques, journal | Lieux ajoutés avec des coordonnées vérifiées par la personne (rien n'est deviné) ; statistiques par période, ville, trajet ou type ; journal d'audit filtrable |
| Notifications (écran 13) | Dans l'application : liste, non lues, compteur, lien vers l'objet, préférences (messages et rappels désactivables, notifications de transaction obligatoires), rappel avant le départ une seule fois. Envoi sur le téléphone par FCM **écrit mais non branché** (voir §2) |
| Messagerie | Entre passager et conducteur d'une réservation ; coordonnées masquées tant que la réservation n'est pas confirmée ; fermée après le trajet ; 20 messages par 10 minutes ; signalement d'un message |
| Avis | Après un trajet effectué et payé ; publiés quand les deux parties ont noté ou à la fin du délai (personne ne voit l'avis de l'autre avant) ; note moyenne sur le profil |
| Partage de trajet et urgence | Lien de partage (SMS, WhatsApp, copie) montrant le trajet, les heures **estimées**, le prénom du conducteur et le véhicule, **sans position GPS** ; un seul lien actif, révocable, expiré 24 h après l'arrivée ; seul son empreinte est stockée. Page d'aide (écran 16) avec questions fréquentes, conseils et numéros d'urgence marqués « à valider » |
| Web et mobile | Écrans 13 et 16 et toutes les fonctions de confiance sur les deux ; console (écran 17) sur le web. Mobile : cloche des notifications, aide, messagerie, signalement, partage, avis, réclamations, champ code promo à la réservation |

## 2. Ce qui est simulé, partiel ou non vérifié

| Élément | État |
|---|---|
| Notifications sur le téléphone | Code FCM écrit, **jamais essayé** : aucune clé fournie, `PUSH_PROVIDER=none`. Les notifications restent dans l'application ; le web et le mobile les relèvent toutes les 60 s |
| Versements aux conducteurs | Préparés et suivis dans la console, mais **effectués à la main** hors de l'application (référence externe saisie). Aucun versement automatique, aucun portefeuille |
| Pénalité conducteur | Décision enregistrée ; aucune retenue automatique sur les gains |
| Plafonds de remboursement | SUPPORT jusqu'à 5 000 XOF, double validation au-delà de 10 000 XOF : valeurs d'exemple, paramétrables |
| Numéros d'urgence | Affichés avec la mention « à valider » : à confirmer auprès des autorités avant publication |
| Exports | CSV produit sur le moment (séparateur `;`), sans numéros de téléphone, formules neutralisées, lien signé à durée limitée. Pas de file pour les très gros exports |
| Promotions | Pas de plafond par appareil (identifiant d'appareil non fiable à ce stade) |
| Parcours dans le navigateur | Fait sur des données de développement. Pour pouvoir laisser un avis et ouvrir une réclamation, j'ai passé par SQL 2 trajets de démonstration en « terminé » ; j'ai créé en local 2 comptes du personnel d'essai et un code promo ESSAI. Les tuiles de carte ne se chargent pas (pas de réseau dans cet environnement) |
| Application mobile | Analysée et testée avec de faux serveurs ; **pas essayée sur un téléphone réel** ni contre l'API |

## 3. Écarts par rapport aux documents validés

- Migration `0016` : note, auteur du refus et double validation des remboursements ; notes internes du personnel ; publication différée et masquage des avis ; lecture et masquage des messages ; délai de réponse et montant décidé des litiges ; un seul lien de partage actif ; désactivation tracée des promotions ; file d'envoi des notifications ; trace des exports ; cycle de vie d'un code promo (réservé, consommé, libéré) géré par la base.
- La console a ses propres cookies et son propre relais au lieu de partager ceux du site, pour qu'un jeton utilisateur ne puisse jamais servir côté administration.
- « Promo libérée » de T3 est maintenant couverte.
- Un utilisateur banni n'entraîne pas encore de message aux passagers de ses trajets (les trajets sont annulés et remboursés, mais sans texte dédié).

## 4. Commandes exécutées (extrait)

```bash
pnpm --filter @ivoirecovoit/backend db:migrate        # 0016
pnpm --filter @ivoirecovoit/backend lint / typecheck / test / build
pnpm --filter @ivoirecovoit/web lint / typecheck / test / build
flutter analyze && flutter test                      # dans apps/mobile
node run9.js                                         # parcours web et console dans Chromium (Playwright)
```

## 5. Résultats des tests réellement obtenus

| Suite | Résultat |
|---|---|
| Backend (Jest, PostGIS, Redis et stockage S3 réels) | **364 / 364** réussis, 27 fichiers (62 nouveaux, dont l'administration et T6, et la confiance : notifications, messagerie, avis, signalements, réclamations, partage, promotions) |
| Web (Vitest) | **71 / 71** réussis, 13 fichiers (relais de la console, routes autorisées, composants avis et signalement) ; `next build` réussi |
| Mobile (flutter test) | **54 / 54** réussis ; `flutter analyze` : aucun problème |
| Lint et types | backend, web : aucune erreur |
| Parcours dans Chromium | Code promo créé dans la console ; réservation avec le code et paiement simulé ; messages entre passager et conducteur ; lien de partage ouvert à 360 px ; signalement ; avis et réclamation après le trajet ; notifications et aide à 360 px sans débordement ; console : tableau de bord, décision de remboursement partiel (1 000 XOF, remboursement validé), signalement traité, toutes les pages, rapprochement, export, fiche de paiement ; compte SUPPORT : menu réduit, page du personnel refusée, refus visibles au journal. 30 captures |
| CI GitHub (28/10/2026) | Commits 6d36ad2 (API), 5d58a21 (web), 6416e40 (correctifs console) et d7fb55a (mobile) : à chaque fois, les 5 tâches réussies (recherche de secrets, backend, web, mobile + APK Android de debug, images Docker) |

Tests serveur ajoutés (extrait) :

- **T6** : toute route `/admin/*` avec un jeton utilisateur : 403 journalisé ; SUPPORT refusé sur l'écriture des paramètres, les règles de frais, le personnel, la validation de remboursement et les pièces ; ADMIN refusé sur les versements ; FINANCE refusé sur la modération des trajets.
- Remboursements : plafond SUPPORT, double validation par une autre personne, refus.
- Notifications : une seule par événement même traité deux fois, préférences, un seul rappel par fenêtre, jeton d'appareil sans envoi si aucun fournisseur.
- Messagerie : coordonnées masquées avant confirmation, tiers refusé (404), fermeture après le trajet, limite d'envoi.
- Avis : publication quand les deux ont noté ou à la fin du délai, délai dépassé.
- Réclamations : ouverture, réponse, gains bloqués, délai de 7 jours.
- Partage : pas de position GPS, un seul lien actif, révocable.
- Promotions : réservé, libéré à l'expiration, consommé au paiement, grand livre équilibré ; « premier trajet » refusé à un passager qui a déjà voyagé.

## 6. Problèmes encore présents

- Esthétique : l'en-tête du site public (« Se connecter ») s'affiche aussi au-dessus de la console.
- À fournir ou décider : clés FCM, numéros d'urgence officiels, plafonds de remboursement, taux de commission et frais de service, frais en cas d'espèces, agrégateur de paiement et mode de versement aux conducteurs.
- Restent ouverts des étapes précédentes : fournisseur SMS, textes juridiques (CGU), serveur OSRM et fournisseur de tuiles, plafond de prix par km, essai sur un vrai téléphone.

## 7. Prochaine étape

**Étape 10 : tests, corrections, déploiement** : campagne complète, tests de charge, analyse ZAP, APK signé de test, `docker-compose.prod.yml`, Caddy et TLS, sauvegardes, guides d'installation Windows et Linux, guide de déploiement, coûts récurrents, liste des éléments à obtenir avant la production.
