-- 0017 : étape 10 : index de la recherche, ajoutés après les tests de charge (50 000 trajets publiés).
-- La recherche filtre les points de montée par heure de passage, puis par distance au lieu demandé ou par lieu
-- du référentiel : sans ces index, chaque recherche parcourait tous les arrêts.
CREATE INDEX trip_stops_pickup_time_idx ON trip_stops (planned_at) WHERE is_pickup;
CREATE INDEX trip_stops_place_idx ON trip_stops (place_id);
