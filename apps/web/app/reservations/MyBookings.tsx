'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BookingStatusBadge } from '@/components/BookingStatusBadge';
import { formatDay, formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { bookings, type BookingSummary } from '@/lib/bookings';
import { formatXof } from '@/lib/format';

type Tab = 'upcoming' | 'past';

/** Écran 12 : réservations à venir et passées. */
export function MyBookings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [items, setItems] = useState<BookingSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bookings.mine(tab).then(
      (res) => {
        if (cancelled) return;
        setItems(res.data);
        setCursor(res.nextCursor);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 401) router.replace('/connexion?next=/reservations');
        else setError(err instanceof ApiRequestError ? err.message : 'Chargement impossible.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tab, router]);

  async function more() {
    if (!cursor) return;
    const res = await bookings.mine(tab, cursor);
    setItems((b) => [...(b ?? []), ...res.data]);
    setCursor(res.nextCursor);
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <h1 className="text-2xl font-bold">Mes réservations</h1>
      <div role="tablist" aria-label="Période" className="flex gap-1 border-b border-line">
        {(
          [
            ['upcoming', 'À venir'],
            ['past', 'Passées'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => {
              setItems(null);
              setError(null);
              setTab(key);
            }}
            className={`min-h-11 px-3 text-sm font-medium ${tab === key ? 'border-b-2 border-brand text-brand' : 'text-ink-muted'}`}
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
        ) : items === null ? (
          <p className="card text-ink-muted">Chargement…</p>
        ) : items.length === 0 ? (
          <div className="card grid gap-2">
            <p className="text-ink-muted">{tab === 'upcoming' ? 'Aucune réservation à venir.' : 'Aucune réservation passée.'}</p>
            {tab === 'upcoming' && (
              <Link href="/" className="text-sm font-semibold text-brand">
                Rechercher un trajet
              </Link>
            )}
          </div>
        ) : (
          <ul className="grid gap-3">
            {items.map((b) => (
              <li key={b.id}>
                <Link href={`/reservations/${b.id}`} className="card grid gap-1 hover:ring-2 hover:ring-brand-soft">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {b.pickup.label} → {b.dropoff.label}
                    </span>
                    <BookingStatusBadge status={b.status} />
                  </span>
                  <span className="text-sm text-ink-muted">
                    {formatDay(b.pickup.plannedAt)} à {formatTime(b.pickup.plannedAt)} · {b.seats} place{b.seats > 1 ? 's' : ''} · {formatXof(b.totalXof)}
                  </span>
                  <span className="text-sm">
                    Réf. {b.reference}
                    {b.trip.driverName && ` · avec ${b.trip.driverName}`}
                    {b.isDemo && <span className="ml-2 rounded bg-warning-soft px-1 text-xs">[DEMO]</span>}
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
