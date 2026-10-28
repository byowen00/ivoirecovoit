# ADR 0003 : implémentation de l'authentification

Date : 28 octobre 2026. Statut : accepté (étape 5).

## Contexte

Le document d'architecture prévoit une authentification « maison » : OTP haché dans Redis, JWT d'accès EdDSA de 15 minutes,
refresh token opaque rotatif haché en base avec détection de réutilisation, mot de passe Argon2id + TOTP pour le personnel,
cookies HttpOnly via un BFF Next.js pour le web.

## Décisions

| Sujet | Choix | Raison |
|---|---|---|
| JWT | `jose` 5 (compatible CommonJS), Ed25519, `iss`/`aud`/`exp` vérifiés, algorithme imposé | Bibliothèque de référence ; la v6 est uniquement ESM (même problème que Nest 12, ADR 0002) |
| Argon2id | `@node-rs/argon2` (binaires précompilés, glibc et musl) | Aucun script d'installation (pnpm 10 les bloque) ; fonctionne dans l'image Alpine |
| TOTP | Implémentation RFC 6238 dans `totp.ts` (≈ 50 lignes), testée avec les vecteurs officiels | Éviter une dépendance pour un algorithme court ; anti-rejeu par `staff_accounts.totp_last_step` |
| Secret TOTP | AES-256-GCM, clé `STAFF_TOTP_ENCRYPTION_KEY` | Une fuite de la base ne livre pas les seconds facteurs |
| OTP | Empreinte HMAC-SHA256(secret, demande, numéro, code) dans Redis avec TTL ; essais comptés par script Lua | Le code en clair n'est jamais stocké ; un code ne vaut que pour sa demande et son numéro |
| Vérification de session | Chaque requête relit la session et le statut du compte en base (une requête indexée) | Déconnexion et suspension immédiates, au prix d'une lecture par requête |
| Comptes incomplets | `first_name`/`last_name` nullables tant que le compte est `PENDING_VERIFICATION` (migration 0012) | Le compte naît à la vérification du numéro ; prénom, nom et CGU viennent juste après |
| Sessions du personnel | `sessions.kind = STAFF`, durée absolue 12 h ; un jeton utilisateur n'ouvre jamais `/admin` et inversement | Séparation stricte des deux mondes |
| Web | Relais `/bff/api/*` limité aux routes `me` et `auth/sessions`, CSRF par double soumission, renouvellement partagé entre requêtes simultanées | Les jetons ne sont jamais lisibles par JavaScript |

## Conséquences et limites connues

- Rotation stricte : si la réponse d'un renouvellement est perdue (réseau coupé au mauvais moment), le jeton suivant est
  considéré comme rejoué et l'appareil doit se reconnecter par SMS. Le mobile et le BFF évitent les renouvellements
  simultanés ; une fenêtre de tolérance pourra être ajoutée si le problème est observé sur le terrain.
- En production, l'API doit être derrière un seul proxy de confiance (`TRUST_PROXY`) pour que les limites par IP voient
  la vraie adresse des visiteurs, y compris ceux du site web relayés par le serveur Next.js.
