import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB, type Db } from '../../database/database.module';

/** Axes mis en avant sur l'accueil (contrat API §5). Liste éditoriale, pas une statistique. */
export const POPULAR_ROUTES: [string, string][] = [
  ['Abidjan', 'Yamoussoukro'],
  ['Abidjan', 'Bouaké'],
  ['Abidjan', 'Grand-Bassam'],
  ['Abidjan', 'San-Pédro'],
  ['Abidjan', 'Daloa'],
  ['Yamoussoukro', 'Abidjan'],
];

export interface PlaceSuggestion {
  id: string;
  kind: string;
  name: string;
  parentName: string | null;
  label: string;
  lat: number;
  lng: number;
  locationPrecision: 'EXACT' | 'APPROX';
}

@Injectable()
export class PlacesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Autocomplétion tolérante aux accents et aux fautes légères (« yamoussokro », « bassam »).
   * Classement : préfixe exact, puis similarité trigramme, puis importance de la localité.
   */
  async autocomplete(query: string, limit: number): Promise<PlaceSuggestion[]> {
    const q = query.trim();
    const { rows } = await sql<PlaceSuggestion>`
      WITH input AS (SELECT normalize_search(${q}) AS q)
      SELECT p.id, p.kind, p.name, parent.name AS "parentName",
             CASE WHEN parent.name IS NULL THEN p.name ELSE p.name || ', ' || parent.name END AS label,
             ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
             p.location_precision AS "locationPrecision"
        FROM places p
        LEFT JOIN places parent ON parent.id = p.parent_id
        CROSS JOIN input
       WHERE p.is_active
         AND (p.search_text LIKE '%' || input.q || '%' OR word_similarity(input.q, p.search_text) >= 0.45)
       ORDER BY (p.search_text LIKE input.q || '%') DESC,
                word_similarity(input.q, p.search_text) DESC,
                p.population_rank ASC NULLS LAST,
                p.name ASC
       LIMIT ${limit}`.execute(this.db);
    return rows;
  }

  async byId(id: string): Promise<PlaceSuggestion | undefined> {
    const { rows } = await sql<PlaceSuggestion>`
      SELECT p.id, p.kind, p.name, parent.name AS "parentName",
             CASE WHEN parent.name IS NULL THEN p.name ELSE p.name || ', ' || parent.name END AS label,
             ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
             p.location_precision AS "locationPrecision"
        FROM places p LEFT JOIN places parent ON parent.id = p.parent_id
       WHERE p.id = ${id} AND p.is_active`.execute(this.db);
    return rows[0];
  }

  /** Le lieu et tous ses descendants (ville -> communes -> quartiers). */
  async withDescendants(id: string): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      WITH RECURSIVE t AS (SELECT id FROM places WHERE id = ${id}
                           UNION ALL SELECT p.id FROM places p JOIN t ON p.parent_id = t.id)
      SELECT id FROM t`.execute(this.db);
    return rows.map((r) => r.id);
  }

  /** Lieu du référentiel le plus proche (20 km au plus) : « Vous êtes vers Cocody ». */
  async reverse(lat: number, lng: number): Promise<(PlaceSuggestion & { distanceM: number }) | null> {
    const { rows } = await sql<PlaceSuggestion & { distanceM: number }>`
      WITH pt AS (SELECT ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography AS g)
      SELECT p.id, p.kind, p.name, parent.name AS "parentName",
             CASE WHEN parent.name IS NULL THEN p.name ELSE p.name || ', ' || parent.name END AS label,
             ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
             p.location_precision AS "locationPrecision", round(ST_Distance(p.location, pt.g))::int AS "distanceM"
        FROM places p LEFT JOIN places parent ON parent.id = p.parent_id CROSS JOIN pt
       WHERE p.is_active AND ST_DWithin(p.location, pt.g, 20000)
       ORDER BY p.location <-> pt.g
       LIMIT 1`.execute(this.db);
    return rows[0] ?? null;
  }

  async popularRoutes() {
    const out = [];
    for (const [fromName, toName] of POPULAR_ROUTES) {
      const { rows } = await sql<{ from: PlaceSuggestion; to: PlaceSuggestion; upcoming: number }>`
        WITH f AS (SELECT id, name, location FROM places WHERE name = ${fromName} AND kind = 'CITY'),
             t AS (SELECT id, name, location FROM places WHERE name = ${toName} AND kind = 'CITY')
        SELECT json_build_object('id', f.id, 'name', f.name, 'label', f.name) AS from,
               json_build_object('id', t.id, 'name', t.name, 'label', t.name) AS to,
               (SELECT count(DISTINCT tr.id)::int FROM trips tr
                  JOIN trip_stops a ON a.trip_id = tr.id AND a.is_pickup
                  JOIN trip_stops b ON b.trip_id = tr.id AND b.is_dropoff AND b.seq > a.seq
                 WHERE tr.status IN ('PUBLISHED','FULL') AND a.planned_at > now()
                   AND ST_DWithin(a.location, f.location, 15000) AND ST_DWithin(b.location, t.location, 15000)) AS upcoming
          FROM f, t`.execute(this.db);
      if (rows[0]) out.push({ from: rows[0].from, to: rows[0].to, upcomingTrips: rows[0].upcoming });
    }
    return out;
  }
}
