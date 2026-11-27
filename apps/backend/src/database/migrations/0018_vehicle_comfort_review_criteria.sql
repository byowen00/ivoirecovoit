-- 0018 : gammes de véhicules et notes détaillées des conducteurs.
-- Gamme déclarée par le conducteur, contrôlée lors de l'examen du véhicule (photos) : Économique, Confort, Luxe.
CREATE TYPE vehicle_comfort AS ENUM ('ECONOMIQUE', 'CONFORT', 'LUXE');
ALTER TABLE vehicles
  ADD COLUMN comfort_class vehicle_comfort NOT NULL DEFAULT 'ECONOMIQUE',
  ADD COLUMN air_conditioning boolean NOT NULL DEFAULT false;

-- Avis d'un passager sur le conducteur, critère par critère (1 à 5) : conduite, ponctualité, confort, amabilité.
ALTER TABLE reviews ADD COLUMN criteria jsonb;
ALTER TABLE reviews ADD CONSTRAINT reviews_criteria_driver_only CHECK (criteria IS NULL OR direction = 'PASSENGER_TO_DRIVER');

-- Moyennes par critère (avis publiés et non masqués), recalculées avec la note générale.
ALTER TABLE driver_profiles ADD COLUMN criteria_avg jsonb;
