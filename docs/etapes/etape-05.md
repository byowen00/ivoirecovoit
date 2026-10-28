# Étape 5 : authentification, rôles et profils

Date : 28 octobre 2026. Statut : **terminée**, à valider.

## 1. Fonctionnalités terminées

| Domaine | Ce qui fonctionne réellement |
|---|---|
| Connexion par code SMS | Un seul parcours inscription/connexion : numéro de mobile ivoirien (01, 05, 07) → code à 6 chiffres valable 5 min, 5 essais, usage unique, lié à la demande et au numéro. Réponse identique que le compte existe ou non. Code jamais stocké en clair (empreinte HMAC dans Redis) |
| Limites anti-abus | 60 s entre deux envois, 3 envois par 15 min et 10 par jour par numéro, 20 par heure par IP, 10 par heure par appareil, réponses 429 avec `Retry-After`. Chaque envoi, échec et blocage est journalisé (`otp_requests_log`) |
| Mode test | `OTP_TEST_MODE=true` : aucun SMS envoyé, code dans les logs et affiché à l'écran (encadré « Mode test »). Refusé en production. Aucun fournisseur SMS n'est intégré : la production refuse de démarrer tant qu'il n'y en a pas |
| Sessions | Jeton d'accès JWT Ed25519 de 15 min ; refresh token opaque de 30 jours, haché en base, renouvelé à chaque usage. Rejouer un ancien refresh token ferme toute la famille de sessions et est journalisé. Déconnexion d'un appareil, de tous, liste des appareils. Chaque requête vérifie la session et le compte en base : une déconnexion ou une suspension prend effet immédiatement |
| Rôles et permissions | Garde globale « sécurité par défaut » (toute route exige une connexion sauf celles marquées publiques). Comptes utilisateurs et personnel strictement séparés. Permissions fines par rôle (SUPPORT, ADMIN, FINANCE, SUPER_ADMIN), avec limite propre au SUPPORT (suspension de 72 h au plus) |
| Personnel | Connexion e-mail + mot de passe (Argon2id) + code TOTP d'une application d'authentification, anti-rejeu du code, même message d'erreur quel que soit le facteur faux, blocage après 5 échecs. Création de compte en ligne de commande (`staff:create`), secret TOTP chiffré en base |
| Administration (API) | Recherche d'utilisateurs avec téléphone et e-mail masqués ; affichage en clair seulement avec la permission `users.read_sensitive` et un motif, journalisé ; suspension et levée de suspension (sessions révoquées, motif obligatoire) ; lecture du journal d'audit |
| Profil | Prénom, nom (seuls le prénom et l'initiale sont publics), e-mail facultatif, bio, préférences (musique, animaux, fumeur, discussion, langues), contact d'urgence privé. Le compte devient actif quand prénom, nom, CGU et politique de confidentialité sont renseignés |
| Consentements | CGU, confidentialité, marketing, position en direct : chaque choix est enregistré et daté (historique conservé). Version périmée refusée ; le retrait des CGU renvoie vers la suppression du compte |
| Suppression du compte | Confirmée par un code SMS dédié ; refusée s'il reste une réservation ou un trajet en cours ; identité effacée, sessions fermées, données financières conservées de façon anonyme |
| Journal d'audit | Inscriptions, connexions, profil, consentements, activation, suppression, rejeux de jetons, connexions du personnel, consultations de données sensibles, suspensions. Sans numéro ni code en clair |
| Web | Écrans connexion (numéro), code (6 cases, collage, compte à rebours, renvoi après 60 s), profil initial, « Mon compte » (informations, préférences, consentements, contact d'urgence, appareils, déconnexion, suppression), pages CGU et confidentialité (en attente de rédaction). Les jetons restent dans des cookies HttpOnly gérés par le serveur web, avec protection CSRF |
| Mobile | Écrans bienvenue (3 diapositives, « Passer »), connexion, code (saisie automatique du SMS sous Android), profil initial, « Mon compte » (mêmes sections que le web). Refresh token dans le stockage sécurisé d'Android, renouvellement unique même si plusieurs appels arrivent ensemble |

## 2. Ce qui est simulé, partiel ou non vérifié

| Élément | État |
|---|---|
| Envoi de SMS | **Aucun fournisseur intégré** (contrat et identifiant d'expéditeur à obtenir). En développement, mode test uniquement |
| Textes CGU et confidentialité | **Non rédigés**. Pages provisoires « version 0.1-brouillon », à faire écrire et valider par un juriste |
| Écran d'administration web | Pas encore construit : les fonctions d'administration existent dans l'API et sont testées, l'interface viendra avec l'écran 17 |
| Photo de profil | Reportée à l'étape 6 avec le stockage des documents (MinIO non disponible ici) |
| Changement de numéro, récupération via le support | Prévus plus tard (EF-06 en I2 ; la récupération par le support demande l'outil de tickets) |
| Préférences de notification, jetons de notification | Étape 9 (notifications) |
| Application mobile | Analysée et testée (18 tests), compilée par la CI ; **pas essayée sur un téléphone réel** |
| Écrans web | Parcours complet essayé dans Chromium (largeur de téléphone) : numéro invalide, code faux, profil, compte, renouvellement de session, déconnexion |

## 3. Écarts par rapport aux documents validés

- Migration `0012` : prénom et nom facultatifs tant que le compte est en attente ; `sessions.kind` (utilisateur ou personnel) et `revoked_reason` ; anti-rejeu TOTP.
- Routes ajoutées : `DELETE /auth/sessions/all`, `POST /me/deletion/otp` (code de suppression), `GET /admin/me`, `POST /admin/logout`.
- Choix techniques détaillés dans `docs/adr/0003-authentification.md` (jose 5, Argon2id précompilé, TOTP maison testé sur les vecteurs de la RFC).

## 4. Commandes exécutées (extrait)

```bash
pnpm --filter @ivoirecovoit/backend add ioredis jose @node-rs/argon2
pnpm --filter @ivoirecovoit/backend db:migrate        # 0012 appliquée
pnpm --filter @ivoirecovoit/backend staff:create -- --email … --role SUPER_ADMIN
pnpm --filter @ivoirecovoit/backend lint / typecheck / test / build
pnpm --filter @ivoirecovoit/web lint / typecheck / test / build
flutter pub add flutter_secure_storage shared_preferences
flutter analyze && flutter test                      # dans apps/mobile
docker build -f apps/backend/Dockerfile .              # puis staff:create et connexion dans le conteneur (Argon2 sous Alpine)
docker build -f apps/web/Dockerfile .                  # puis connexion complète via /bff contre l'API
node flow.js                                           # parcours web dans Chromium (Playwright)
```

## 5. Résultats des tests réellement obtenus

| Suite | Résultat |
|---|---|
| Backend (Jest, PostGIS et Redis réels) | **122 / 122** réussis, 10 suites |
| Web (Vitest) | **26 / 26** réussis, 5 fichiers |
| Mobile (flutter test) | **18 / 18** réussis |
| Lint et types | backend, web : aucune erreur ; `flutter analyze` : aucun problème |
| Builds | backend, web (`next build`), images Docker backend et web : réussis |
| CI GitHub (28/10/2026, commit 7ad747c) | Les 5 tâches réussies : recherche de secrets, backend (avec PostGIS et Redis), web, mobile + APK Android de debug, images Docker |

Tests d'authentification couverts : inscription puis activation, réponse identique compte existant ou non, numéros refusés (fixe, étranger, préfixe inconnu), code faux puis blocage au 5e essai, code expiré, code d'un autre numéro refusé, usage unique, délai de 60 s et 3 envois par 15 min, limites par IP et par appareil, code jamais stocké, jeton absent, modifié ou expiré, rotation et rejeu (famille révoquée), déconnexion immédiate, session d'un autre compte (404), déconnexion de tous les appareils, jeton utilisateur refusé sur l'administration et inversement, validation du profil, e-mail déjà pris, versions de CGU, consentement de géolocalisation daté, contact d'urgence, suppression avec code, code de connexion refusé pour la suppression, production refusée sans secrets ni fournisseur SMS.

Personnel et permissions : connexion TOTP, rejeu refusé, erreurs identiques, blocage après 5 échecs, compte désactivé, matrice initiale (4 rôles × 5 actions), motif obligatoire et journalisé pour les données sensibles, suspension avec révocation des sessions et reconnexion refusée, suspension échue, compte du personnel protégé.

## 6. Problèmes encore présents

- Il faut un fournisseur SMS (contrat, identifiant d'expéditeur, coût par message) avant toute mise en ligne.
- Les textes juridiques sont à rédiger.
- Une coupure réseau pile pendant un renouvellement de session oblige l'appareil à redemander un code (voir ADR 0003).
- Les coordonnées des lieux restent à vérifier (étape 4).

## 7. Prochaine étape

**Étape 6 : conducteurs, véhicules, trajets et recherche** : profil conducteur et documents (stockage privé), véhicules, publication d'un trajet avec arrêts, itinéraire OSRM, recherche par segment.
