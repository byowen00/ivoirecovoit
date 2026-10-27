#!/usr/bin/env bash
# Prépare les données de routage OSRM pour la Côte d'Ivoire (à lancer une fois, puis à chaque mise à jour OSM).
# Source : extrait OpenStreetMap publié par Geofabrik (licence ODbL, attribution « © OpenStreetMap contributors »).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data
IMAGE=ghcr.io/project-osrm/osrm-backend:v5.27.1
if [ ! -f data/ivory-coast-latest.osm.pbf ]; then
  curl -fL -o data/ivory-coast-latest.osm.pbf https://download.geofabrik.de/africa/ivory-coast-latest.osm.pbf
fi
docker run --rm -v "$PWD/data:/data" "$IMAGE" osrm-extract -p /opt/car.lua /data/ivory-coast-latest.osm.pbf
docker run --rm -v "$PWD/data:/data" "$IMAGE" osrm-partition /data/ivory-coast-latest.osrm
docker run --rm -v "$PWD/data:/data" "$IMAGE" osrm-customize /data/ivory-coast-latest.osrm
echo "Données OSRM prêtes. Lancer : docker compose -f infrastructure/docker-compose.yml --profile routing up -d osrm"
