# Tests de charge (k6)

À lancer **uniquement** sur une base dédiée, jamais sur la production ni la pré-production partagée.

```bash
# 1. Base dédiée : schéma, référentiel, données [DEMO], puis 50 000 trajets fictifs [CHARGE]
psql "$ADMIN_URL" -c "CREATE DATABASE ivoirecovoit_load"
DATABASE_URL=$LOAD_DATABASE_URL pnpm db:migrate && DATABASE_URL=$LOAD_DATABASE_URL pnpm db:seed && DATABASE_URL=$LOAD_DATABASE_URL pnpm db:seed:demo
psql "$LOAD_DATABASE_URL" -f tests/charge/seed-charge.sql

# 2. API hors production, derrière laquelle on simule des clients différents (X-Forwarded-For)
NODE_ENV=staging PORT=3200 TRUST_PROXY=1 OTP_TEST_MODE=true DATABASE_URL=$LOAD_DATABASE_URL \
  REDIS_URL=redis://127.0.0.1:6379/4 node apps/backend/dist/main.js

# 3. Recherche : 100 utilisateurs simultanés avec une pause d'environ 1 s ; THINK=0 pour le débit maximal
PLACES=$(psql "$LOAD_DATABASE_URL" -Atc "select json_build_object('abidjan',(select json_agg(id) from places where parent_id is not null or name='Abidjan'),'cities',(select json_agg(id) from places where parent_id is null and name<>'Abidjan'))")
docker run --rm --network host -v "$PWD/tests/charge:/scripts" -e API=http://127.0.0.1:3200 -e PLACES="$PLACES" grafana/k6 run /scripts/recherche.js

# 4. Pic de réservations : 40 passagers sur les mêmes trajets en même temps
TRIPS=$(psql "$LOAD_DATABASE_URL" -Atc "select json_agg(id) from (select id from trips where public_ref like 'LT%' and acceptance_mode='AUTO' and departure_at > now() + interval '3 days' order by public_ref limit 5) s")
docker run --rm --network host -v "$PWD/tests/charge:/scripts" -e API=http://127.0.0.1:3200 -e TRIPS="$TRIPS" grafana/k6 run /scripts/reservations.js
```

Contrôle après le pic : pour chaque trajet, la somme des places réservées ne dépasse jamais les places offertes
(`trip_max_occupancy`). Résultats obtenus : voir `docs/etapes/etape-10.md`.
