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
    <article className="card relative grid gap-4 transition-shadow hover:shadow-[0_8px_24px_rgb(17_24_28/0.10)]">
      <div className="flex items-start justify-between gap-3">
        <div className="grid grid-cols-[auto_auto_1fr] gap-x-3">
          <p className="font-display text-lg font-extrabold tabular-nums">{formatTime(trip.pickup.plannedAt)}</p>
          <span className="mt-2 flex flex-col items-center row-span-3" aria-hidden="true">
            <span className="size-2.5 rounded-full border-[2.5px] border-brand" />
            <span className="my-1 w-0.5 flex-1 bg-line" />
            <span className="size-2.5 rounded-[3px] bg-success" />
          </span>
          <p className="font-semibold">
            <Link href={href} className="after:absolute after:inset-0">
              {trip.pickup.label}
            </Link>
            {pickupWalk && <span className="block text-xs font-normal text-ink-muted">{pickupWalk}</span>}
          </p>
          <p className="py-1 text-xs text-ink-muted tabular-nums">{formatDuration(trip.estimatedDurationS)}</p>
          <span />
          <p className="font-display text-lg font-bold text-ink-muted tabular-nums">{formatTime(trip.dropoff.plannedAt)}</p>
          <p className="font-semibold">
            {trip.dropoff.label}
            {dropoffWalk && <span className="block text-xs font-normal text-ink-muted">{dropoffWalk}</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-extrabold tabular-nums">{formatXof(trip.unitPriceXof)}</p>
          <p className="text-xs text-ink-muted">par place</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{trip.driver.displayName}</span>
          <span className="text-ink-muted">
            {trip.driver.ratingAvg !== null ? `★ ${trip.driver.ratingAvg.toFixed(1)} (${trip.driver.ratingCount})` : 'Nouveau conducteur'}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {trip.driver.verified && <span className="chip chip-success">Vérifié</span>}
          {trip.acceptanceMode === 'AUTO' && <span className="chip chip-brand">Réservation immédiate</span>}
          <span className={`chip ${trip.seatsAvailable <= 1 ? 'bg-danger-soft text-danger' : 'chip-neutral'}`}>
            {trip.seatsAvailable} place{trip.seatsAvailable > 1 ? 's' : ''} libre{trip.seatsAvailable > 1 ? 's' : ''}
          </span>
          {trip.isDemo && <span className="chip bg-warning-soft text-ink">[DEMO]</span>}
        </div>
      </div>
      <p className="-mt-2 flex flex-wrap gap-x-3 text-xs text-ink-muted">
        <span>
          {trip.vehicle.make} {trip.vehicle.model}
        </span>
        <span>{trip.stopsCount === 0 ? 'Direct' : `${trip.stopsCount} arrêt${trip.stopsCount > 1 ? 's' : ''}`}</span>
        {trip.estimatedDistanceM !== null && <span>{formatDistance(trip.estimatedDistanceM)} (estimation)</span>}
      </p>
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
