import type { PlaceSuggestion } from './places';
import type { LuggagePolicy, TripKind } from './trips';

/** Brouillon local de l'assistant de publication (écran 10) : reste sur l'appareil, jamais envoyé tant qu'on ne publie pas. */
export interface TripDraft {
  version: 1;
  step: 1 | 2 | 3 | 4;
  kind: TripKind;
  origin: PlaceSuggestion | null;
  destination: PlaceSuggestion | null;
  stops: (PlaceSuggestion | null)[];
  meetingPoints: string[];
  date: string;
  time: string;
  vehicleId: string;
  seats: number;
  acceptanceMode: 'AUTO' | 'MANUAL';
  luggagePolicy: LuggagePolicy;
  allowsCash: boolean;
  description: string;
  instructions: string;
  /** Prix cumulés depuis le départ, un par point (départ = 0). Vide tant que l'aperçu n'a pas été calculé. */
  stopPrices: number[];
  /** Clé d'idempotence de la future création : un double envoi ne crée qu'un trajet. */
  idempotencyKey: string;
  savedAt: number;
}

export const DRAFT_KEY = 'ic_trip_draft_v1';
const MAX_AGE_MS = 14 * 86_400_000;

export function emptyDraft(idempotencyKey: string, date: string): TripDraft {
  return {
    version: 1,
    step: 1,
    kind: 'INTERCITY',
    origin: null,
    destination: null,
    stops: [],
    meetingPoints: [],
    date,
    time: '07:00',
    vehicleId: '',
    seats: 3,
    acceptanceMode: 'AUTO',
    luggagePolicy: 'MEDIUM',
    allowsCash: false,
    description: '',
    instructions: '',
    stopPrices: [],
    idempotencyKey,
    savedAt: Date.now(),
  };
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // stockage bloqué (navigation privée, réglages) : l'assistant fonctionne sans brouillon
  }
}

export function loadDraft(now = Date.now()): TripDraft | null {
  try {
    const raw = storage()?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<TripDraft>;
    if (d.version !== 1 || typeof d.idempotencyKey !== 'string' || typeof d.savedAt !== 'number') return null;
    if (now - d.savedAt > MAX_AGE_MS) {
      clearDraft();
      return null;
    }
    return d as TripDraft;
  } catch {
    return null;
  }
}

export function saveDraft(d: TripDraft): void {
  try {
    storage()?.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    // quota dépassé ou stockage indisponible : on continue sans brouillon
  }
}

export function clearDraft(): void {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    // rien à faire
  }
}

/** Points du trajet dans l'ordre (départ, arrêts renseignés, arrivée). */
export function draftPoints(d: TripDraft): PlaceSuggestion[] {
  return [d.origin, ...d.stops, d.destination].filter((p): p is PlaceSuggestion => p !== null);
}

/** Départ en ISO à l'heure d'Abidjan (UTC+0 toute l'année). */
export function draftDepartureIso(d: TripDraft): string {
  return new Date(`${d.date}T${d.time}:00Z`).toISOString();
}

/** Problèmes bloquants pour passer à l'étape suivante. */
export function stepErrors(d: TripDraft, step: number, now = Date.now()): string[] {
  const errors: string[] = [];
  if (step >= 1) {
    if (!d.origin) errors.push('Choisissez le lieu de départ.');
    if (!d.destination) errors.push('Choisissez le lieu d’arrivée.');
    if (d.stops.some((s) => s === null)) errors.push('Choisissez chaque arrêt intermédiaire ou retirez-le.');
    const ids = draftPoints(d).map((p) => p.id);
    if (new Set(ids).size !== ids.length) errors.push('Un même lieu apparaît deux fois.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^\d{2}:\d{2}$/.test(d.time)) errors.push('Indiquez la date et l’heure de départ.');
    else if (new Date(draftDepartureIso(d)).getTime() < now + 30 * 60_000) errors.push('Le départ doit être au moins 30 minutes après maintenant.');
  }
  if (step >= 2) {
    if (!d.vehicleId) errors.push('Choisissez un véhicule validé.');
    if (!(d.seats >= 1 && d.seats <= 8)) errors.push('Nombre de places invalide.');
  }
  if (step >= 3 && d.stopPrices.length !== draftPoints(d).length) errors.push('Calculez le prix du trajet.');
  return errors;
}
