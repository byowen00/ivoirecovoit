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

export interface SearchInitial {
  from?: PlaceRef | null;
  to?: PlaceRef | null;
  date?: string;
  seats?: number;
}

const asSuggestion = (p: PlaceRef | null | undefined): PlaceSuggestion | null =>
  p ? { id: p.id, label: p.label, name: p.label, kind: 'CITY', parentName: null, lat: 0, lng: 0, locationPrecision: 'APPROX' } : null;

export function resultsHref(from: PlaceRef, to: PlaceRef, date: string, seats: number): string {
  const q = new URLSearchParams({ from: from.id, fromLabel: from.label, to: to.id, toLabel: to.label, seats: String(seats) });
  if (date) q.set('date', date);
  return `/recherche?${q}`;
}

/** Formulaire de recherche (écran 4, repris en tête de l'écran 5 pour modifier la recherche). */
export function SearchForm({ initial = {}, compact = false }: { initial?: SearchInitial; compact?: boolean }) {
  const router = useRouter();
  const [from, setFrom] = useState<PlaceSuggestion | null>(asSuggestion(initial.from));
  const [to, setTo] = useState<PlaceSuggestion | null>(asSuggestion(initial.to));
  const [date, setDate] = useState(initial.date ?? todayInAbidjan());
  const [seats, setSeats] = useState(initial.seats ?? 1);
  const [error, setError] = useState<string | null>(null);
  // Inverser remonte les deux champs pour qu'ils affichent leur nouvelle valeur.
  const [swaps, setSwaps] = useState(0);
  const samePlace = from !== null && to !== null && from.id === to.id;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!from || !to) {
      setError('Choisissez le départ et l’arrivée dans la liste des suggestions.');
      return;
    }
    if (samePlace) return;
    setError(null);
    router.push(resultsHref(from, to, date, seats));
  }

  function swap() {
    setFrom(to);
    setTo(from);
    setSwaps((n) => n + 1);
  }

  return (
    <form
      aria-label="Rechercher un trajet"
      noValidate
      className={`grid gap-2 rounded-[var(--radius-card)] bg-surface shadow-sm ${compact ? 'p-3 sm:grid-cols-[1fr_auto_1fr_10rem_7rem_auto] sm:items-start sm:gap-3' : 'p-4 sm:p-6'}`}
      onSubmit={submit}
    >
      <PlaceInput key={`from-${swaps}`} label="Départ" placeholder="Ville, commune ou quartier" value={from} onChange={setFrom} />
      <button
        type="button"
        onClick={swap}
        className={`btn-secondary min-h-10 justify-self-end px-3 text-sm ${compact ? 'sm:mt-7' : '-my-2'}`}
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
          <input id="date" type="date" min={todayInAbidjan()} value={date} onChange={(e) => setDate(e.target.value)} className="field" />
        </div>
        {!compact && <SeatsSelect seats={seats} setSeats={setSeats} />}
      </div>
      {compact && <SeatsSelect seats={seats} setSeats={setSeats} />}

      <button type="submit" disabled={samePlace} className={`btn-primary ${compact ? 'sm:mt-7' : 'mt-3'}`}>
        Rechercher
      </button>
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
