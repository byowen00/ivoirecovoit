import type { ColumnType, Generated } from 'kysely';

/*
 * Types Kysely des tables utilisées par le code. Ils sont complétés module par module
 * (étapes 5 à 9) ; la source de vérité du schéma reste les migrations SQL.
 */

export interface PlacesTable {
  id: string;
  kind: 'CITY' | 'COMMUNE' | 'NEIGHBORHOOD' | 'LANDMARK' | 'STATION';
  name: string;
  parent_id: string | null;
  aliases: string[];
  search_text: Generated<string>;
  location: string; // geography : lu et écrit via les fonctions PostGIS
  location_precision: 'EXACT' | 'APPROX';
  country_code: Generated<string>;
  population_rank: number | null;
  is_active: Generated<boolean>;
  created_at: ColumnType<Date, never, never>;
}

export interface Database {
  places: PlacesTable;
}
