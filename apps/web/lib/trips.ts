import { send } from './account';
import { apiGet } from './api';

export type TripKind = 'URBAN' | 'INTERCITY';
export type TripStatus = 'DRAFT' | 'PUBLISHED' | 'FULL' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type LuggagePolicy = 'NONE' | 'SMALL' | 'MEDIUM' | 'LARGE';
export type LatLng = [number, number];

export interface SearchParams {
  fromPlaceId?: string;
  toPlaceId?: string;
  fromLat?: number;
  fromLng?: number;
  toLat?: number;
  toLng?: number;
  date?: string;
  timeFrom?: string;
  timeTo?: string;
  seats?: number;
  maxPriceXof?: number;
  directOnly?: boolean;
  sort?: 'departure' | 'price' | 'distance' | 'rating';
  cursor?: string;
}

export interface SearchResult {
  tripId: string;
  publicRef: string;
  kind: TripKind;
  pickup: { stopId: string; label: string; plannedAt: string; distanceFromQueryM: number; lat: number; lng: number };
  dropoff: { stopId: string; label: string; plannedAt: string; distanceFromQueryM: number };
  estimatedDurationS: number;
  estimatedDistanceM: number | null;
  isEstimate: true;
  unitPriceXof: number;
  seatsAvailable: number;
  acceptanceMode: 'AUTO' | 'MANUAL';
  driver: { id: string; displayName: string; ratingAvg: number | null; ratingCount: number; verified: boolean };
  vehicle: { make: string; model: string; color: string };
  stopsCount: number;
  isDemo: boolean;
}

export interface SearchResponse {
  data: SearchResult[];
  nextCursor: string | null;
  query: { from: { label: string; lat: number; lng: number }; to: { label: string; lat: number; lng: number }; seats: number; date: string | null };
}

export interface TripStop {
  id: string;
  seq: number;
  label: string;
  meetingPoint: string | null;
  lat: number;
  lng: number;
  locationPrecision: 'EXACT' | 'APPROX';
  plannedAt: string;
  priceFromOriginXof: number;
  isPickup: boolean;
  isDropoff: boolean;
}

export interface TripDetail {
  id: string;
  publicRef: string;
  status: TripStatus;
  kind: TripKind;
  departureAt: string;
  estimatedArrivalAt: string;
  estimatedDistanceM: number;
  estimatedDurationS: number;
  routeSource: 'OSRM' | 'ESTIMATE' | string | null;
  isEstimate: true;
  coordinatesPrecision: 'EXACT' | 'ROUNDED';
  geometry: LatLng[];
  seatsOffered: number;
  segments: { fromSeq: number; toSeq: number; seatsAvailable: number }[];
  stops: TripStop[];
  driver: {
    id: string;
    displayName: string;
    photoUrl: string | null;
    ratingAvg: number | null;
    ratingCount: number;
    completedTripsCount: number;
    verified: boolean;
    memberSince: string;
    preferences: Record<string, unknown>;
  } | null;
  vehicle: { make: string; model: string; color: string; plateNumber: string | null };
  acceptanceMode: 'AUTO' | 'MANUAL';
  cancellationPolicy: { code: string; label: string; rules: unknown };
  allowsCash: boolean;
  luggagePolicy: LuggagePolicy;
  description: string | null;
  instructions: string | null;
  cancellationReason: string | null;
  isDemo: boolean;
}

export interface Availability {
  pickup: { stopId: string; label: string };
  dropoff: { stopId: string; label: string };
  unitPriceXof: number;
  seatsAvailable: number;
  bookable: boolean;
}

export interface PublicDriver {
  id: string;
  displayName: string;
  photoUrl: string | null;
  bio: string | null;
  preferences: { music?: boolean; pets?: boolean; smoking?: boolean; chat?: string; languages?: string[] };
  memberSince: string;
  verified: boolean;
  verificationLevel: number;
  verifiedSince: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  completedTripsCount: number;
  upcomingTripsCount: number;
  isDemo: boolean;
  vehicles: { make: string; model: string; color: string; year: number | null; seats: number }[];
  reviews: { id: string; rating: number; comment: string | null; publishedAt: string; author: string | null }[];
}

export interface PopularRoute {
  from: { id: string; name: string; label: string };
  to: { id: string; name: string; label: string };
  upcomingTrips: number;
}

export function searchQueryString(p: SearchParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === '' || v === false) continue;
    q.set(k, String(v));
  }
  return q.toString();
}

export const publicTrips = {
  search: (p: SearchParams, signal?: AbortSignal) => apiGet<SearchResponse>(`/trips/search?${searchQueryString(p)}`, { signal }),
  detail: (id: string, signal?: AbortSignal) => apiGet<TripDetail>(`/trips/${encodeURIComponent(id)}`, { signal }),
  availability: (id: string, pickupStopId: string, dropoffStopId: string, signal?: AbortSignal) =>
    apiGet<Availability>(`/trips/${encodeURIComponent(id)}/availability?${new URLSearchParams({ pickupStopId, dropoffStopId })}`, {
      signal,
      retries: 1,
    }),
  driver: (id: string, signal?: AbortSignal) => apiGet<PublicDriver>(`/drivers/${encodeURIComponent(id)}`, { signal }),
  popularRoutes: (signal?: AbortSignal) => apiGet<{ data: PopularRoute[] }>('/places/popular-routes', { signal, retries: 1 }),
};

// ------------------------------------------------------------------ espace conducteur (relais authentifié)

export interface StopDraft {
  placeId?: string;
  label: string;
  meetingPoint?: string;
  lat?: number;
  lng?: number;
}

export type PriceProblem =
  | { code: 'NOT_MULTIPLE_OF_50'; index: number }
  | { code: 'ORIGIN_NOT_ZERO' }
  | { code: 'NOT_INCREASING'; index: number }
  | { code: 'BELOW_MIN'; from: number; to: number; priceXof: number }
  | { code: 'ABOVE_MAX'; priceXof: number }
  | { code: 'ABOVE_KM_CAP'; from: number; to: number; priceXof: number; capXof: number };

/** Explication en clair d'un problème de prix renvoyé par l'API (labels = noms des arrêts). */
export function priceProblemText(p: PriceProblem, labels: string[], bounds: { minXof: number; maxXof: number }): string {
  const name = (i: number) => labels[i] ?? `arrêt ${i + 1}`;
  switch (p.code) {
    case 'NOT_MULTIPLE_OF_50':
      return `Le prix jusqu’à ${name(p.index)} doit être un multiple de 50 FCFA.`;
    case 'ORIGIN_NOT_ZERO':
      return 'Le prix au point de départ doit être 0.';
    case 'NOT_INCREASING':
      return `Le prix jusqu’à ${name(p.index)} doit être supérieur à celui de l’arrêt précédent.`;
    case 'BELOW_MIN':
      return `De ${name(p.from)} à ${name(p.to)} : ${p.priceXof} FCFA, en dessous du minimum de ${bounds.minXof} FCFA.`;
    case 'ABOVE_MAX':
      return `Prix complet de ${p.priceXof} FCFA, au-dessus du maximum de ${bounds.maxXof} FCFA.`;
    case 'ABOVE_KM_CAP':
      return `De ${name(p.from)} à ${name(p.to)} : ${p.priceXof} FCFA dépasse le plafond de ${p.capXof} FCFA pour cette distance.`;
  }
}

export interface TripPreview {
  estimatedDistanceM: number;
  estimatedDurationS: number;
  routeSource: string;
  isEstimate: true;
  geometry: LatLng[];
  estimatedArrivalAt: string;
  stops: (Omit<TripStop, 'id' | 'seq'> & { placeId: string | null })[];
  price: {
    suggestedPriceXof: number;
    minXof: number;
    maxXof: number;
    capXofPerKm: number | null;
    problems: PriceProblem[];
  };
}

export interface CreateTripBody {
  vehicleId: string;
  kind: TripKind;
  departureAt: string;
  stops: StopDraft[];
  pricePerSeatXof: number;
  stopPricesXof?: number[];
  seatsOffered: number;
  acceptanceMode: 'AUTO' | 'MANUAL';
  allowsCash: boolean;
  luggagePolicy: LuggagePolicy;
  description?: string;
  instructions?: string;
  publish: boolean;
}

export interface MyTrip {
  id: string;
  publicRef: string;
  status: TripStatus;
  kind: TripKind;
  departureAt: string;
  estimatedArrivalAt: string;
  origin: string;
  destination: string;
  intermediateStops: number;
  priceXof: number;
  seatsOffered: number;
  seatsOccupied: number;
  activeBookings: number;
  vehicle: string;
  version: number;
}

export interface ManagedTrip {
  id: string;
  publicRef: string;
  status: TripStatus;
  version: number;
  kind: TripKind;
  departureAt: string;
  estimatedArrivalAt: string;
  estimatedDistanceM: number;
  estimatedDurationS: number;
  routeSource: string | null;
  geometry: LatLng[];
  seatsOffered: number;
  seatsOccupied: number;
  acceptanceMode: 'AUTO' | 'MANUAL';
  allowsCash: boolean;
  luggagePolicy: LuggagePolicy;
  description: string | null;
  instructions: string | null;
  cancellationReason: string | null;
  isDemo: boolean;
  vehicle: { id: string; make: string; model: string; color: string; plateNumber: string; seatsCapacity: number; status: string };
  stops: (TripStop & { placeId: string | null })[];
  bookings: { id: string; reference: string; status: string; seats: number; passenger: { displayName: string | null }; pickup: string | null; dropoff: string | null }[];
  actions: { canEdit: boolean; canPublish: boolean; canCancel: boolean; canStart: boolean; canComplete: boolean; canDuplicate: boolean };
}

/** Clé d'idempotence : un double clic ou une reprise réseau ne crée pas deux trajets. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

const idem = (key: string) => ({ 'Idempotency-Key': key });

export const driverTrips = {
  preview: (body: Pick<CreateTripBody, 'kind' | 'departureAt' | 'stops' | 'stopPricesXof'> & { vehicleId?: string; pricePerSeatXof?: number }) =>
    send<TripPreview>('/bff/api/trips/preview', 'POST', body),
  create: (body: CreateTripBody, key: string) => send<ManagedTrip>('/bff/api/trips', 'POST', body, idem(key)),
  mine: (status: 'upcoming' | 'in_progress' | 'past' | 'draft', cursor?: string) =>
    send<{ data: MyTrip[]; nextCursor: string | null }>(`/bff/api/trips/mine?${new URLSearchParams({ status, ...(cursor ? { cursor } : {}) })}`, 'GET'),
  manage: (id: string) => send<ManagedTrip>(`/bff/api/trips/${id}/manage`, 'GET'),
  update: (id: string, version: number, patch: Record<string, unknown>) =>
    send<ManagedTrip>(`/bff/api/trips/${id}`, 'PATCH', patch, { 'If-Match': String(version) }),
  publish: (id: string) => send<ManagedTrip>(`/bff/api/trips/${id}/publish`, 'POST'),
  cancel: (id: string, reason: string, key: string) => send<ManagedTrip>(`/bff/api/trips/${id}/cancel`, 'POST', { reason }, idem(key)),
  start: (id: string) => send<ManagedTrip>(`/bff/api/trips/${id}/start`, 'POST'),
  complete: (id: string) => send<ManagedTrip>(`/bff/api/trips/${id}/complete`, 'POST'),
  duplicate: (id: string, dates: string[], publish: boolean, key: string) =>
    send<{ data: { date: string; tripId: string | null; status: string | null; error?: { code: string; message: string } }[] }>(
      `/bff/api/trips/${id}/duplicate`,
      'POST',
      { dates, publish },
      idem(key),
    ),
};

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publié',
  FULL: 'Complet',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};

export const LUGGAGE_LABEL: Record<LuggagePolicy, string> = {
  NONE: 'Pas de bagage',
  SMALL: 'Petit sac',
  MEDIUM: 'Bagage moyen',
  LARGE: 'Gros bagage',
};

export function routeSourceNote(source: string | null): string {
  return source === 'OSRM'
    ? 'Distance et durée estimées d’après le réseau routier, sans tenir compte du trafic.'
    : 'Distance et durée estimées à vol d’oiseau (service d’itinéraire indisponible) : à titre indicatif.';
}
