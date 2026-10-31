'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PlaceSuggestion } from '@/lib/places';
import { PlaceInput } from './PlaceInput';

export function todayInAbidjan(): string {
  // Abidjan est en UTC+0 toute l'année : la date UTC est la date locale.
  return new Date().toISOString().slice(0, 10);
}

/** Lieu minimal transporté dans l'adresse de la page de résultats (identifiant + libellé affiché). */
export interface PlaceRef {
  id: string;
  label: string;
}

/** Position du navigateur (« Ma position ») utilisée comme départ. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface SearchInitial {
  from?: PlaceRef | null;
  fromPoint?: GeoPoint | null;
  to?: PlaceRef | null;
  date?: string;
  seats?: number;
  now?: boolean;
}

/** Durée couverte par « Partir maintenant », en heures. */
export const NOW_WINDOW_HOURS = 3;

/** Plage « Partir maintenant » à l'heure d'Abidjan (UTC) : de maintenant à +3 h, sans dépasser minuit. */
export function nowWindow(at = new Date()): { date: string; timeFrom: string; timeTo: string } {
  const hhmm = (d: Date) => d.toISOString().slice(11, 16);
  const end = new Date(at.getTime() + NOW_WINDOW_HOURS * 3_600_000);
  const date = at.toISOString().slice(0, 10);
  return { date, timeFrom: hhmm(at), timeTo: end.toISOString().slice(0, 10) === date ? hhmm(end) : '23:59' };
}

const asSuggestion = (p: PlaceRef | null | undefined): PlaceSuggestion | null =>
  p ? { id: p.id, label: p.label, name: p.label, kind: 'CITY', parentName: null, lat: 0, lng: 0, locationPrecision: 'APPROX' } : null;

export function resultsHref(
  from: PlaceRef | GeoPoint,
  to: PlaceRef,
  date: string,
  seats: number,
  window?: { timeFrom: string; timeTo: string },
): string {
  const q = new URLSearchParams(
    'id' in from
      ? { from: from.id, fromLabel: from.label }
      : { fromLat: from.lat.toFixed(5), fromLng: from.lng.toFixed(5), fromLabel: 'Ma position' },
  );
  q.set('to', to.id);
  q.set('toLabel', to.label);
  q.set('seats', String(seats));
  if (date) q.set('date', date);
  if (date && window) {
    q.set('timeFrom', window.timeFrom);
    q.set('timeTo', window.timeTo);
  }
  return `/recherche?${q}`;
}

/** Position approximative du navigateur, demandée seulement au clic sur « Partir de ma position ». */
function locate(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Votre navigateur ne donne pas accès à la position. Choisissez le départ dans la liste.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Sans accès à votre position, choisissez le départ dans la liste.'
              : 'Position introuvable pour le moment. Réessayez ou choisissez le départ.',
          ),
        ),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

/** Formulaire de recherche (écran 4, repris en tête de l'écran 5 pour modifier la recherche). */
export function SearchForm({ initial = {}, compact = false }: { initial?: SearchInitial; compact?: boolean }) {
  const router = useRouter();
  const [from, setFrom] = useState<PlaceSuggestion | null>(asSuggestion(initial.from));
  const [point, setPoint] = useState<GeoPoint | null>(initial.fromPoint ?? null);
  const [locating, setLocating] = useState(false);
  const [now, setNow] = useState(initial.now ?? false);
  const [to, setTo] = useState<PlaceSuggestion | null>(asSuggestion(initial.to));
  const [date, setDate] = useState(initial.date ?? todayInAbidjan());
  const [seats, setSeats] = useState(initial.seats ?? 1);
  const [error, setError] = useState<string | null>(null);
  // Inverser remonte les deux champs pour qu'ils affichent leur nouvelle valeur.
  const [swaps, setSwaps] = useState(0);
  const samePlace = !point && from !== null && to !== null && from.id === to.id;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const origin = point ?? from;
    if (!origin || !to) {
      setError('Choisissez le départ et l’arrivée dans la liste des suggestions.');
      return;
    }
    if (samePlace) return;
    setError(null);
    if (now) {
      const w = nowWindow();
      router.push(resultsHref(origin, to, w.date, seats, w));
    } else {
      router.push(resultsHref(origin, to, date, seats));
    }
  }

  async function useMyPosition() {
    setLocating(true);
    setError(null);
    try {
      setPoint(await locate());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLocating(false);
    }
  }

  function swap() {
    if (point) return; // « Ma position » ne sert que de départ
    setFrom(to);
    setTo(from);
    setSwaps((n) => n + 1);
  }

  return (
    <form
      aria-label="Rechercher un trajet"
      noValidate
      className={`grid gap-2 rounded-[var(--radius-card)] bg-surface shadow-[0_12px_32px_rgb(17_24_28/0.10)] ${compact ? 'p-3 sm:grid-cols-[1fr_auto_1fr_10rem_7rem_auto] sm:items-start sm:gap-3' : 'p-4 sm:p-6'}`}
      onSubmit={submit}
    >
      <div className="grid gap-1">
        {point ? (
          <div>
            <span className="mb-1 block text-sm font-medium">Départ</span>
            <div className="flex min-h-12 items-center justify-between gap-2 rounded-[var(--radius-control)] bg-brand-soft px-3">
              <span className="whitespace-nowrap font-semibold">📍 Ma position</span>
              <button type="button" className="text-sm font-semibold text-brand-strong underline-offset-4 hover:underline" onClick={() => setPoint(null)}>
                Changer
              </button>
            </div>
          </div>
        ) : (
          <PlaceInput key={`from-${swaps}`} label="Départ" placeholder="Ville, commune ou quartier" value={from} onChange={setFrom} />
        )}
        {!point && (
          <button
            type="button"
            onClick={useMyPosition}
            disabled={locating}
            className="justify-self-start text-sm font-semibold text-brand underline-offset-4 hover:underline disabled:opacity-60"
          >
            {locating ? 'Localisation…' : '⌖ Partir de ma position'}
          </button>
        )}
      </div>
      <button
        type="button"
        disabled={!!point}
        onClick={swap}
        className={`btn-secondary min-h-10 justify-self-end px-3 text-sm ${compact ? 'sm:mt-7' : point ? '-my-2' : '-mt-9 -mb-2'}`}
        aria-label="Inverser départ et arrivée"
      >
        ⇅
      </button>
      <PlaceInput key={`to-${swaps}`} label="Arrivée" placeholder="Ville, commune ou quartier" value={to} onChange={setTo} />
      {samePlace && <p className="text-sm text-danger sm:col-span-full">Le départ et l’arrivée doivent être différents.</p>}

      <div className={compact ? '' : 'grid grid-cols-2 gap-3'}>
        <div>
          <label htmlFor="date" className="mb-1 block text-sm font-medium">
            Date
          </label>
          <input
            id="date"
            type="date"
            min={todayInAbidjan()}
            value={date}
            disabled={now}
            onChange={(e) => setDate(e.target.value)}
            className="field disabled:opacity-50"
          />
          <label className="mt-2 flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
            ⚡ Partir maintenant
          </label>
        </div>
        {!compact && <SeatsSelect seats={seats} setSeats={setSeats} />}
      </div>
      {compact && <SeatsSelect seats={seats} setSeats={setSeats} />}

      <button type="submit" disabled={samePlace} className={`btn-primary ${compact ? 'sm:mt-7' : 'mt-3'}`}>
        Rechercher
      </button>
      {now && (
        <p className="text-xs text-ink-muted sm:col-span-full">
          Départs des {NOW_WINDOW_HOURS} prochaines heures, réservables au plus tard 30 minutes avant.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger sm:col-span-full">
          {error}
        </p>
      )}
    </form>
  );
}

function SeatsSelect({ seats, setSeats }: { seats: number; setSeats: (n: number) => void }) {
  return (
    <div>
      <label htmlFor="seats" className="mb-1 block text-sm font-medium">
        Places
      </label>
      <select id="seats" value={seats} onChange={(e) => setSeats(Number(e.target.value))} className="field">
        {[1, 2, 3, 4].map((n) => (
          <option key={n} value={n}>
            {n} {n > 1 ? 'places' : 'place'}
          </option>
        ))}
      </select>
    </div>
  );
}
