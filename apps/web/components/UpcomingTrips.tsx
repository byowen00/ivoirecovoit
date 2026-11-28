'use client';

import { useEffect, useState } from 'react';
import { COMFORT, COMFORT_CLASSES, type ComfortClass } from '@/lib/comfort';
import { publicTrips, type SearchResult, type TripKind } from '@/lib/trips';
import { formatDay, TripCard, TripCardSkeleton } from './TripCard';

const KINDS: { value: TripKind | null; label: string }[] = [
  { value: null, label: 'Tous' },
  { value: 'URBAN', label: 'En ville' },
  { value: 'INTERCITY', label: 'Interurbain' },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-10 rounded-full px-3 py-1 text-sm font-semibold ${active ? 'bg-night text-white' : 'bg-brand-soft text-brand-strong'}`}
    >
      {children}
    </button>
  );
}

/** Prochains trajets proposés (14 jours), sans recherche, filtrables par type et par gamme. */
export function UpcomingTrips() {
  const [kind, setKind] = useState<TripKind | null>(null);
  const [comfort, setComfort] = useState<ComfortClass | null>(null);
  const key = `${kind}-${comfort}`;
  const [loaded, setLoaded] = useState<{ key: string; trips: SearchResult[] | 'error' } | null>(null);
  // Tant que la réponse du choix courant n'est pas arrivée, on affiche le chargement.
  const trips = loaded?.key === key ? loaded.trips : null;

  useEffect(() => {
    const controller = new AbortController();
    publicTrips.upcoming({ kind: kind ?? undefined, comfort: comfort ?? undefined }, controller.signal).then(
      (res) => setLoaded({ key, trips: res.data }),
      () => {
        if (!controller.signal.aborted) setLoaded({ key, trips: 'error' });
      },
    );
    return () => controller.abort();
  }, [key, kind, comfort]);

  return (
    <section aria-labelledby="upcoming-title" className="grid gap-4">
      <h2 id="upcoming-title" className="text-lg font-bold">
        Trajets proposés
      </h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Type de trajet">
        {KINDS.map((k) => (
          <Chip key={k.label} active={kind === k.value} onClick={() => setKind(k.value)}>
            {k.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Gamme de véhicule">
        <Chip active={comfort === null} onClick={() => setComfort(null)}>
          Toutes les gammes
        </Chip>
        {COMFORT_CLASSES.map((c) => (
          <Chip key={c} active={comfort === c} onClick={() => setComfort(c)}>
            {COMFORT[c].icon} {COMFORT[c].label}
          </Chip>
        ))}
      </div>
      {trips === null ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
          <TripCardSkeleton />
          <TripCardSkeleton />
        </div>
      ) : trips === 'error' ? (
        <p className="text-ink-muted">Impossible de charger les trajets proposés pour le moment.</p>
      ) : trips.length === 0 ? (
        <p className="text-ink-muted">Aucun trajet proposé dans les 14 prochains jours pour ce choix.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {trips.map((t) => (
            <li key={t.tripId} className="grid gap-1">
              <p className="text-sm font-semibold text-ink-muted capitalize">{formatDay(t.pickup.plannedAt)}</p>
              <TripCard trip={t} seats={1} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
