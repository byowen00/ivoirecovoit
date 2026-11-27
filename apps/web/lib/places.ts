import { apiGet } from './api';

export interface PlaceSuggestion {
  id: string;
  kind: 'CITY' | 'COMMUNE' | 'NEIGHBORHOOD' | 'LANDMARK' | 'STATION';
  name: string;
  parentName: string | null;
  label: string;
  lat: number;
  lng: number;
  locationPrecision: 'EXACT' | 'APPROX';
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q, limit: '6' });
  const res = await apiGet<{ data: PlaceSuggestion[] }>(`/places/autocomplete?${params}`, { signal, retries: 1 });
  return res.data;
}

export const PLACE_KIND_LABEL: Record<PlaceSuggestion['kind'], string> = {
  CITY: 'Ville',
  COMMUNE: 'Commune',
  NEIGHBORHOOD: 'Quartier',
  LANDMARK: 'Lieu',
  STATION: 'Gare',
};

/** Lieu connu le plus proche d'un point (20 km au plus), ou null. */
export async function reversePlace(lat: number, lng: number): Promise<PlaceSuggestion | null> {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  const res = await apiGet<{ data: PlaceSuggestion | null }>(`/places/reverse?${params}`, { retries: 1 });
  return res.data;
}
