'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { type PopularRoute, publicTrips } from '@/lib/trips';
import { resultsHref, todayInAbidjan } from './SearchForm';

/** Axes populaires avec le nombre de trajets à venir (écran 4). Rien n'est affiché si l'API est injoignable. */
export function PopularRoutes() {
  const [routes, setRoutes] = useState<PopularRoute[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    publicTrips.popularRoutes(controller.signal).then(
      (res) => setRoutes(res.data),
      () => setRoutes([]),
    );
    return () => controller.abort();
  }, []);

  if (routes === null) {
    return (
      <ul className="mt-6 flex flex-wrap gap-2" aria-busy="true" aria-label="Trajets populaires">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="h-8 w-40 animate-pulse rounded-full bg-line" />
        ))}
      </ul>
    );
  }
  if (routes.length === 0) return null;
  return (
    <ul className="mt-6 flex flex-wrap gap-2" aria-label="Trajets populaires">
      {routes.map((r) => (
        <li key={`${r.from.id}-${r.to.id}`}>
          <Link
            href={resultsHref(r.from, r.to, todayInAbidjan(), 1).replace(/&date=[^&]*/, '')}
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-sm text-brand-strong hover:underline"
          >
            {r.from.label} → {r.to.label}
            <span className="text-xs text-ink-muted">
              {r.upcomingTrips === 0 ? 'aucun trajet' : `${r.upcomingTrips} trajet${r.upcomingTrips > 1 ? 's' : ''}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
