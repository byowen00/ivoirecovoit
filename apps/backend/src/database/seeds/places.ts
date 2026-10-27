import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { uuidv7 } from '../../common/ids';

type Row = [string, number, number, string[]];
type NeighborhoodRow = [string, string, number, number, string[]];

interface PlacesFile {
  cities: Row[];
  abidjanCommunes: Row[];
  abidjanNeighborhoods: NeighborhoodRow[];
}

async function upsertPlace(
  client: Client,
  kind: string,
  name: string,
  parentId: string | null,
  lat: number,
  lng: number,
  aliases: string[],
  rank: number | null,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO places (id, kind, name, parent_id, aliases, location, location_precision, population_rank)
     VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, 'APPROX', $8)
     ON CONFLICT (parent_id, name) DO UPDATE SET aliases = EXCLUDED.aliases
     RETURNING id`,
    [uuidv7(), kind, name, parentId, aliases, lat, lng, rank],
  );
  return rows[0]!.id;
}

/** Charge le référentiel des lieux (coordonnées approximatives, voir places-ci.json). */
export async function seedPlaces(client: Client): Promise<number> {
  const data = JSON.parse(readFileSync(join(__dirname, 'places-ci.json'), 'utf8')) as PlacesFile;
  const ids = new Map<string, string>();
  let count = 0;

  for (const [i, [name, lat, lng, aliases]] of data.cities.entries()) {
    ids.set(name, await upsertPlace(client, 'CITY', name, null, lat, lng, aliases, i + 1));
    count++;
  }
  const abidjan = ids.get('Abidjan')!;
  for (const [name, lat, lng, aliases] of data.abidjanCommunes) {
    ids.set(name, await upsertPlace(client, 'COMMUNE', name, abidjan, lat, lng, aliases, null));
    count++;
  }
  for (const [commune, name, lat, lng, aliases] of data.abidjanNeighborhoods) {
    const parent = ids.get(commune);
    if (!parent) throw new Error(`Commune inconnue dans places-ci.json : ${commune}`);
    const kind = name.startsWith('Gare') ? 'STATION' : 'NEIGHBORHOOD';
    await upsertPlace(client, kind, name, parent, lat, lng, aliases, null);
    count++;
  }
  return count;
}
