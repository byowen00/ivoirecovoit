'use client';

import { useEffect, useState } from 'react';
import { formatDay, formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { type SharedTrip, trust } from '@/lib/trust';

const REFRESH_MS = 60_000;

/** Page publique ouverte par un proche : trajet, horaires estimés, conducteur et véhicule, sans position GPS. */
export function SharedTripView({ token }: { token: string }) {
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      trust.sharedTrip(token).then(
        (t) => {
          setTrip(t);
          setError(null);
        },
        (err: unknown) =>
          setError(err instanceof ApiRequestError && err.status === 404 ? 'Ce lien de partage n’existe pas, a été désactivé ou a expiré.' : 'Impossible de charger le trajet. Réessayez.'),
      );
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [token]);

  if (!trip) return <p role={error ? 'alert' : undefined} className="card mx-auto max-w-xl">{error ?? 'Chargement…'}</p>;
  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <div>
        <p className="text-sm text-ink-muted">Un proche partage son trajet IvoireCovoit avec vous.</p>
        <h1 className="text-2xl font-bold">
          {trip.pickup.label} → {trip.dropoff.label}
        </h1>
        {trip.isDemo && <span className="rounded bg-warning-soft px-1 text-xs text-ink">[DEMO]</span>}
      </div>
      <p role="status" className={`card font-semibold ${trip.status === 'CANCELLED' ? 'text-danger' : ''}`}>
        {trip.statusText}
      </p>
      <section className="card grid gap-2">
        <p className="text-sm text-ink-muted">{formatDay(trip.pickup.plannedAt)}</p>
        <p>
          <strong className="tabular-nums">{formatTime(trip.pickup.plannedAt)}</strong> départ prévu de {trip.pickup.label}
        </p>
        <p>
          <strong className="tabular-nums">{formatTime(trip.dropoff.plannedAt)}</strong> arrivée prévue à {trip.dropoff.label}
        </p>
        {trip.startedAt && <p className="text-sm">Le conducteur a indiqué le départ à {formatTime(trip.startedAt)}.</p>}
        {trip.completedAt && <p className="text-sm">Le conducteur a indiqué l’arrivée à {formatTime(trip.completedAt)}.</p>}
        <p className="text-xs text-ink-muted">
          Horaires estimés, susceptibles de varier avec la circulation. Cette page ne montre aucune position GPS en direct.
        </p>
      </section>
      <section className="card grid gap-1 text-sm">
        <p>Conducteur : {trip.driver.firstName ?? '—'}</p>
        <p>
          Véhicule : {trip.vehicle.make} {trip.vehicle.model}, {trip.vehicle.color}
          {trip.vehicle.plateNumber ? ` · ${trip.vehicle.plateNumber}` : ''}
        </p>
      </section>
      <p className="text-xs text-ink-muted">
        Lien valable jusqu’au {formatDay(trip.expiresAt)} à {formatTime(trip.expiresAt)}. En cas d’inquiétude, appelez votre proche ou les secours.
      </p>
    </div>
  );
}
