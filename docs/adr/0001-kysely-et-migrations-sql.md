# ADR 0001 : Kysely et migrations en SQL pur plutôt que Prisma

- Statut : accepté (étape 4)
- Contexte : le schéma repose sur PostGIS (`geography`), des contraintes d'exclusion GiST, des index partiels, des triggers d'intégrité (transitions de statut, équilibre du grand livre, plafond des remboursements) et des verrous `SELECT … FOR UPDATE`. L'architecture initiale proposait Prisma complété par du SQL.
- Problèmes constatés avec Prisma : types PostGIS non pris en charge (`Unsupported`), migrations générées qui entrent en conflit avec le SQL écrit à la main, moteur binaire à télécharger (bloquant dans certains environnements de CI ou réseaux restreints).
- Décision : migrations écrites en SQL (`apps/backend/src/database/migrations/NNNN_nom.sql`), appliquées dans l'ordre par un exécuteur maison (une transaction par fichier, verrou consultatif, somme de contrôle SHA-256 qui interdit de modifier une migration déjà appliquée). Accès aux données via Kysely, constructeur de requêtes typé, sans moteur externe.
- Conséquences : le SQL est explicite et relu ; les types TypeScript des tables (`src/database/types.ts`) sont maintenus à la main au fil des modules ; les règles critiques sont doublées en base (deuxième ligne de défense).

# ADR 0002 : versions figées de NestJS 11 et Kysely 0.28

- Statut : accepté (étape 4)
- NestJS 12 et Kysely 0.29 sont publiés uniquement au format ES Modules, ce qui casse l'outillage de test Jest/ts-jest (CommonJS) avec Node 22. NestJS 11 et Kysely 0.28 sont stables, documentés et compatibles. Une migration vers ESM pourra être faite plus tard, en un seul changement isolé.
