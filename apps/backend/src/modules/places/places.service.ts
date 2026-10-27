import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB, type Db } from '../../database/database.module';

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
}
