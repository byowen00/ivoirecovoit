import Link from 'next/link';
import { formatDistance, formatDuration, formatXof } from '@/lib/format';
import type { SearchResult } from '@/lib/trips';

const time = new Intl.DateTimeFormat('fr-CI', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Abidjan' });
const day = new Intl.DateTimeFormat('fr-CI', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Abidjan' });

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}
export function formatDay(iso: string): string {
  return day.format(new Date(iso));
}

function walk(m: number): string | null {
  if (m < 300) return null;
  return `à ${formatDistance(m).replace('env. ', '')} du point demandé`;
}

/** Une carte de résultat (écran 5). L'adresse transporte le segment choisi pour l'écran de détail. */
export function TripCard({ trip, seats }: { trip: SearchResult; seats: number }) {
  const href = `/trajets/${trip.tripId}?${new URLSearchParams({ pickup: trip.pickup.stopId, dropoff: trip.dropoff.stopId, seats: String(seats) })}`;
  const pickupWalk = walk(trip.pickup.distanceFromQueryM);
  const dropoffWalk = walk(trip.dropoff.distanceFromQueryM);
  return (
    <article className="card relative grid gap-3 hover:ring-2 hover:ring-brand-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="grid grid-cols-[auto_1fr] gap-x-3">
          <p className="font-semibold tabular-nums">{formatTime(trip.pickup.plannedAt)}</p>
          <p className="font-medium">
            <Link href={href} className="after:absolute after:inset-0">
              {trip.pickup.label}
            </Link>
            {pickupWalk && <span className="block text-xs text-ink-muted">{pickupWalk}</span>}
          </p>
          <p className="text-xs text-ink-muted tabular-nums">{formatDuration(trip.estimatedDurationS)}</p>
          <span />
          <p className="font-semibold tabular-nums">{formatTime(trip.dropoff.plannedAt)}</p>
          <p className="font-medium">
            {trip.dropoff.label}
            {dropoffWalk && <span className="block text-xs text-ink-muted">{dropoffWalk}</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-brand-strong">{formatXof(trip.unitPriceXof)}</p>
          <p className="text-xs text-ink-muted">par place</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
        <span className="font-medium text-ink">
          {trip.driver.displayName}
          {trip.driver.verified && <span className="ml-1 text-success" title="Profil vérifié">✓ vérifié</span>}
        </span>
        <span>{trip.driver.ratingAvg !== null ? `★ ${trip.driver.ratingAvg.toFixed(1)} (${trip.driver.ratingCount})` : 'Nouveau conducteur'}</span>
        <span>
          {trip.vehicle.make} {trip.vehicle.model}
        </span>
        <span>{trip.stopsCount === 0 ? 'Direct' : `${trip.stopsCount} arrêt${trip.stopsCount > 1 ? 's' : ''}`}</span>
        <span className={trip.seatsAvailable <= 1 ? 'font-medium text-danger' : ''}>
          {trip.seatsAvailable} place{trip.seatsAvailable > 1 ? 's' : ''} libre{trip.seatsAvailable > 1 ? 's' : ''}
        </span>
        {trip.acceptanceMode === 'AUTO' && <span>Réservation immédiate</span>}
        {trip.estimatedDistanceM !== null && <span>{formatDistance(trip.estimatedDistanceM)} (estimation)</span>}
        {trip.isDemo && <span className="rounded bg-warning-soft px-1 text-xs text-ink">[DEMO]</span>}
      </div>
    </article>
  );
}

export function TripCardSkeleton() {
  return (
    <div className="card grid gap-3" aria-hidden="true">
      <div className="h-5 w-2/3 animate-pulse rounded bg-line" />
      <div className="h-5 w-1/2 animate-pulse rounded bg-line" />
      <div className="h-4 w-full animate-pulse rounded bg-line" />
    </div>
  );
}
