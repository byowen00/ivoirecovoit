'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { SearchForm } from '@/components/SearchForm';
import { TripCard, TripCardSkeleton } from '@/components/TripCard';
import { type MapPoint, TripMap } from '@/components/TripMap';
import { ApiRequestError } from '@/lib/api';
import { formatXof } from '@/lib/format';
import { publicTrips, type SearchParams, type SearchResponse, type SearchResult } from '@/lib/trips';

type Sort = NonNullable<SearchParams['sort']>;
type Period = 'all' | 'morning' | 'afternoon' | 'evening';

const PERIODS: Record<Period, [string, string] | null> = {
  all: null,
  morning: ['00:00', '11:59'],
  afternoon: ['12:00', '17:59'],
  evening: ['18:00', '23:59'],
};

const SORT_LABEL: Record<Sort, string> = {
  departure: 'Départ le plus tôt',
  price: 'Prix le plus bas',
  distance: 'Plus proche',
  rating: 'Mieux noté',
};

/** Écran 5 : résultats en liste ou sur carte, filtres, pagination. */
export function SearchResults() {
  const params = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const fromLabel = params.get('fromLabel') ?? '';
  const toLabel = params.get('toLabel') ?? '';
  const date = params.get('date') ?? '';
  const seats = Math.min(8, Math.max(1, Number(params.get('seats')) || 1));

  const [sort, setSort] = useState<Sort>('departure');
  const [period, setPeriod] = useState<Period>('all');
  const [maxPrice, setMaxPrice] = useState('');
  const [directOnly, setDirectOnly] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');

  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [meta, setMeta] = useState<SearchResponse['query'] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo<SearchParams | null>(() => {
    if (!from || !to) return null;
    const window = PERIODS[period];
    const price = Number(maxPrice);
    return {
      fromPlaceId: from,
      toPlaceId: to,
      date: date || undefined,
      timeFrom: date && window ? window[0] : undefined,
      timeTo: date && window ? window[1] : undefined,
      seats,
      sort,
      directOnly,
      maxPriceXof: maxPrice && Number.isInteger(price) && price > 0 ? price : undefined,
    };
  }, [from, to, date, seats, sort, period, maxPrice, directOnly]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    // Petite attente pour la saisie du prix maximum : une seule requête une fois la valeur tapée.
    const timer = setTimeout(() => {
      setResults(null);
      setError(null);
      publicTrips.search(query, controller.signal).then(
        (res) => {
          setResults(res.data);
          setMeta(res.query);
          setCursor(res.nextCursor);
        },
        (err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err instanceof ApiRequestError ? err.message : 'Recherche impossible pour le moment.');
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function loadMore() {
    if (!query || !cursor) return;
    setLoadingMore(true);
    try {
      const res = await publicTrips.search({ ...query, cursor });
      setResults((r) => [...(r ?? []), ...res.data]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Chargement impossible.');
    } finally {
      setLoadingMore(false);
    }
  }

  const points = useMemo<MapPoint[]>(() => {
    const list: MapPoint[] = (results ?? []).map((r) => ({
      id: r.tripId,
      lat: r.pickup.lat,
      lng: r.pickup.lng,
      tone: 'result',
      label: `${r.pickup.label} · ${formatXof(r.unitPriceXof)}`,
    }));
    if (meta) {
      list.push({ lat: meta.from.lat, lng: meta.from.lng, tone: 'origin', label: `Départ demandé : ${meta.from.label}` });
      list.push({ lat: meta.to.lat, lng: meta.to.lng, tone: 'destination', label: `Arrivée demandée : ${meta.to.label}` });
    }
    return list;
  }, [results, meta]);

  if (!from || !to) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-bold">Rechercher un trajet</h1>
        <SearchForm />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <SearchForm compact initial={{ from: { id: from, label: fromLabel }, to: { id: to, label: toLabel }, date, seats }} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">
            {fromLabel || 'Départ'} → {toLabel || 'Arrivée'}
          </h1>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {results === null
              ? 'Recherche en cours…'
              : `${results.length}${cursor ? '+' : ''} trajet${results.length > 1 ? 's' : ''} · ${seats} place${seats > 1 ? 's' : ''}`}
          </p>
        </div>
        <div role="group" aria-label="Affichage" className="flex overflow-hidden rounded-[var(--radius-control)] border border-line">
          {(['list', 'map'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`min-h-10 px-4 text-sm font-medium ${view === v ? 'bg-brand text-white' : 'bg-surface'}`}
            >
              {v === 'list' ? 'Liste' : 'Carte'}
            </button>
          ))}
        </div>
      </div>

      <details className="card md:open:block" open>
        <summary className="cursor-pointer font-medium">Filtres et tri</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="sort" className="mb-1 block text-sm font-medium">
              Trier par
            </label>
            <select id="sort" className="field" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {Object.entries(SORT_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="period" className="mb-1 block text-sm font-medium">
              Heure de départ
            </label>
            <select id="period" className="field" value={period} onChange={(e) => setPeriod(e.target.value as Period)} disabled={!date}>
              <option value="all">Toute la journée</option>
              <option value="morning">Avant midi</option>
              <option value="afternoon">12 h – 18 h</option>
              <option value="evening">Après 18 h</option>
            </select>
          </div>
          <div>
            <label htmlFor="maxPrice" className="mb-1 block text-sm font-medium">
              Prix maximum (FCFA)
            </label>
            <input
              id="maxPrice"
              className="field"
              inputMode="numeric"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Aucun"
            />
          </div>
          <label className="flex items-center gap-3 sm:mt-7">
            <input type="checkbox" className="h-5 w-5" checked={directOnly} onChange={(e) => setDirectOnly(e.target.checked)} />
            Trajets directs uniquement
          </label>
        </div>
      </details>

      {error && (
        <p role="alert" className="card text-danger">
          {error}
        </p>
      )}

      {view === 'map' && (
        <TripMap
          points={points}
          label="Carte des points de montée des trajets trouvés"
          className="h-[28rem]"
          onSelect={(id) => document.getElementById(`trip-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        />
      )}

      {results === null && !error ? (
        <div className="grid gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <TripCardSkeleton key={i} />
          ))}
        </div>
      ) : results && results.length === 0 ? (
        <EmptyState date={date} filtered={directOnly || !!maxPrice || period !== 'all'} />
      ) : (
        <ul className="grid gap-3">
          {results?.map((r) => (
            <li key={r.tripId} id={`trip-${r.tripId}`}>
              <TripCard trip={r} seats={seats} />
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <button type="button" className="btn-secondary justify-self-center" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? 'Chargement…' : 'Voir plus de trajets'}
        </button>
      )}
      <p className="text-xs text-ink-muted">Horaires, distances et durées sont des estimations fournies par les conducteurs et le calcul d’itinéraire.</p>
    </div>
  );
}

function EmptyState({ date, filtered }: { date: string; filtered: boolean }) {
  return (
    <div className="card grid gap-2 text-center">
      <p className="text-lg font-semibold">Aucun trajet trouvé</p>
      <p className="text-ink-muted">
        {filtered
          ? 'Essayez d’assouplir les filtres (prix, horaire, trajets directs).'
          : date
            ? 'Aucun conducteur ne propose ce trajet ce jour-là. Essayez une autre date ou une ville proche.'
            : 'Aucun trajet à venir sur cet axe pour le moment.'}
      </p>
      <Link href="/conducteur/publier" className="justify-self-center text-sm font-semibold text-brand underline-offset-4 hover:underline">
        Vous faites ce trajet ? Proposez vos places
      </Link>
    </div>
  );
}
