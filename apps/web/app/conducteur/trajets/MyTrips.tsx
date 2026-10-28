'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatDay, formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { formatXof } from '@/lib/format';
import { driverTrips, type MyTrip, TRIP_STATUS_LABEL } from '@/lib/trips';

type Tab = 'upcoming' | 'in_progress' | 'past' | 'draft';
const TABS: [Tab, string][] = [
  ['upcoming', 'À venir'],
  ['in_progress', 'En cours'],
  ['past', 'Passés'],
  ['draft', 'Brouillons'],
];
const EMPTY: Record<Tab, string> = {
  upcoming: 'Aucun trajet publié à venir.',
  in_progress: 'Aucun trajet en cours.',
  past: 'Aucun trajet passé.',
  draft: 'Aucun brouillon enregistré.',
};

/** Écran 11 : gestion des trajets du conducteur, par onglets. */
export function MyTrips() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [trips, setTrips] = useState<MyTrip[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    driverTrips.mine(tab).then(
      (res) => {
        if (cancelled) return;
        setTrips(res.data);
        setCursor(res.nextCursor);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 401) router.replace('/connexion?next=/conducteur/trajets');
        else setError(err instanceof ApiRequestError ? err.message : 'Chargement impossible.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tab, router]);

  async function more() {
    if (!cursor) return;
    const res = await driverTrips.mine(tab, cursor);
    setTrips((t) => [...(t ?? []), ...res.data]);
    setCursor(res.nextCursor);
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Mes trajets</h1>
        <Link href="/conducteur/publier" className="btn-primary">
          Publier un trajet
        </Link>
      </div>
      <div role="tablist" aria-label="Statut des trajets" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => {
              setTrips(null);
              setError(null);
              setTab(key);
            }}
            className={`min-h-11 whitespace-nowrap px-3 text-sm font-medium ${tab === key ? 'border-b-2 border-brand text-brand' : 'text-ink-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {error ? (
          <p role="alert" className="card text-danger">
            {error}
          </p>
        ) : trips === null ? (
          <p className="card text-ink-muted">Chargement…</p>
        ) : trips.length === 0 ? (
          <p className="card text-ink-muted">{EMPTY[tab]}</p>
        ) : (
          <ul className="grid gap-3">
            {trips.map((t) => (
              <li key={t.id}>
                <Link href={`/conducteur/trajets/${t.id}`} className="card grid gap-1 hover:ring-2 hover:ring-brand-soft">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {t.origin} → {t.destination}
                    </span>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">{TRIP_STATUS_LABEL[t.status]}</span>
                  </span>
                  <span className="text-sm text-ink-muted">
                    {formatDay(t.departureAt)} à {formatTime(t.departureAt)}
                    {t.intermediateStops > 0 && ` · ${t.intermediateStops} arrêt${t.intermediateStops > 1 ? 's' : ''}`} · {formatXof(t.priceXof)}
                  </span>
                  <span className="text-sm">
                    {t.seatsOccupied}/{t.seatsOffered} places réservées · {t.vehicle}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <button type="button" className="btn-secondary mt-3" onClick={() => void more()}>
            Voir plus
          </button>
        )}
      </div>
    </div>
  );
}
