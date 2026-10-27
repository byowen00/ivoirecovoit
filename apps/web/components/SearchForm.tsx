'use client';

import { useState } from 'react';
import type { PlaceSuggestion } from '@/lib/places';
import { PlaceInput } from './PlaceInput';

function todayInAbidjan(): string {
  // Abidjan est en UTC+0 toute l'année : la date UTC est la date locale.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Formulaire de recherche de l'écran d'accueil.
 * La saisie des lieux fonctionne dès cette étape ; la recherche de trajets est livrée à l'étape 6.
 */
export function SearchForm() {
  const [from, setFrom] = useState<PlaceSuggestion | null>(null);
  const [to, setTo] = useState<PlaceSuggestion | null>(null);
  const [date, setDate] = useState(todayInAbidjan());
  const [seats, setSeats] = useState(1);
  const samePlace = from !== null && to !== null && from.id === to.id;

  return (
    <form
      aria-label="Rechercher un trajet"
      className="grid gap-2 rounded-[var(--radius-card)] bg-surface p-4 shadow-sm sm:p-6"
      onSubmit={(e) => e.preventDefault()}
    >
      <PlaceInput label="Départ" placeholder="Ville, commune ou quartier" value={from} onChange={setFrom} />
      <PlaceInput label="Arrivée" placeholder="Ville, commune ou quartier" value={to} onChange={setTo} />
      {samePlace && <p className="text-sm text-danger">Le départ et l’arrivée doivent être différents.</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="date" className="mb-1 block text-sm font-medium">
            Date
          </label>
          <input
            id="date"
            type="date"
            min={todayInAbidjan()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-12 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3"
          />
        </div>
        <div>
          <label htmlFor="seats" className="mb-1 block text-sm font-medium">
            Places
          </label>
          <select
            id="seats"
            value={seats}
            onChange={(e) => setSeats(Number(e.target.value))}
            className="h-12 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} {n > 1 ? 'places' : 'place'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled
        aria-describedby="search-soon"
        className="mt-3 h-12 rounded-[var(--radius-control)] bg-brand px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Rechercher
      </button>
      <p id="search-soon" className="text-center text-sm text-ink-muted">
        La recherche de trajets sera disponible à l’étape 6 du développement.
      </p>
    </form>
  );
}
