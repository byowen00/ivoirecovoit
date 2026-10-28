'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { formatDay, formatTime } from '@/components/TripCard';
import { type MapPoint, TripMap } from '@/components/TripMap';
import { ApiRequestError } from '@/lib/api';
import { formatDistance, formatDuration, formatXof } from '@/lib/format';
import { type Availability, LUGGAGE_LABEL, publicTrips, routeSourceNote, TRIP_STATUS_LABEL, type TripDetail } from '@/lib/trips';

/** Écran 6 : détail d'un trajet, choix du segment, prix et places pour ce segment. */
export function TripDetailView({ id }: { id: string }) {
  const params = useSearchParams();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickup, setPickup] = useState<string | null>(params.get('pickup'));
  const [dropoff, setDropoff] = useState<string | null>(params.get('dropoff'));
  // Disponibilité mémorisée avec le segment demandé : une réponse ne s'affiche que pour son segment.
  const [quote, setQuote] = useState<{ key: string; data: Availability } | null>(null);
  const seats = Math.max(1, Number(params.get('seats')) || 1);

  useEffect(() => {
    const controller = new AbortController();
    publicTrips.detail(id, controller.signal).then(
      (t) => {
        setTrip(t);
        // Segment par défaut : tout le trajet, sauf si la recherche en a fixé un.
        setPickup((p) => (p && t.stops.some((s) => s.id === p && s.isPickup) ? p : t.stops[0]!.id));
        setDropoff((d) => (d && t.stops.some((s) => s.id === d && s.isDropoff) ? d : t.stops.at(-1)!.id));
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiRequestError && err.status === 404 ? 'Ce trajet n’existe pas ou n’est plus visible.' : 'Impossible de charger ce trajet.');
      },
    );
    return () => controller.abort();
  }, [id]);

  const pickupSeq = trip?.stops.find((s) => s.id === pickup)?.seq ?? 0;
  const dropoffSeq = trip?.stops.find((s) => s.id === dropoff)?.seq ?? 0;
  const validSegment = !!trip && dropoffSeq > pickupSeq;

  const segmentKey = `${pickup}:${dropoff}`;
  useEffect(() => {
    if (!trip || !pickup || !dropoff || !validSegment) return;
    const controller = new AbortController();
    publicTrips.availability(trip.id, pickup, dropoff, controller.signal).then(
      (data) => setQuote({ key: `${pickup}:${dropoff}`, data }),
      () => undefined,
    );
    return () => controller.abort();
  }, [trip, pickup, dropoff, validSegment]);
  const availability = quote?.key === segmentKey ? quote.data : null;

  const points = useMemo<MapPoint[]>(
    () =>
      (trip?.stops ?? []).map((s, i, all) => ({
        lat: s.lat,
        lng: s.lng,
        label: `${formatTime(s.plannedAt)} · ${s.label}`,
        tone: i === 0 ? 'origin' : i === all.length - 1 ? 'destination' : 'stop',
      })),
    [trip],
  );

  if (error) {
    return (
      <div className="card grid gap-2">
        <p role="alert" className="text-danger">
          {error}
        </p>
        <Link href="/" className="text-sm font-semibold text-brand">
          Nouvelle recherche
        </Link>
      </div>
    );
  }
  if (!trip) return <p className="card text-ink-muted">Chargement du trajet…</p>;

  const bookable = ['PUBLISHED', 'FULL'].includes(trip.status);
  const enoughSeats = (availability?.seatsAvailable ?? 0) >= seats;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div className="grid gap-4">
        <div>
          <p className="text-sm text-ink-muted">
            {formatDay(trip.departureAt)} · Réf. {trip.publicRef}
            {trip.isDemo && <span className="ml-2 rounded bg-warning-soft px-1 text-xs text-ink">[DEMO]</span>}
          </p>
          <h1 className="text-2xl font-bold">
            {trip.stops[0]!.label} → {trip.stops.at(-1)!.label}
          </h1>
          {!bookable && (
            <p role="status" className="mt-2 rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-sm">
              Trajet {TRIP_STATUS_LABEL[trip.status].toLowerCase()}.{trip.cancellationReason ? ` Motif : ${trip.cancellationReason}` : ''}
            </p>
          )}
        </div>

        <TripMap points={points} route={trip.geometry} label="Carte de l’itinéraire estimé du trajet" />
        <p className="text-xs text-ink-muted">
          {routeSourceNote(trip.routeSource)} {formatDistance(trip.estimatedDistanceM)}, {formatDuration(trip.estimatedDurationS)}.
          {trip.coordinatesPrecision === 'ROUNDED' && ' Les points précis sont communiqués aux passagers confirmés.'}
        </p>

        <section aria-labelledby="stops-title" className="card">
          <h2 id="stops-title" className="mb-3 text-lg font-semibold">
            Itinéraire et arrêts
          </h2>
          <ol className="grid gap-3">
            {trip.stops.map((s) => {
              const inSegment = validSegment && s.seq >= pickupSeq && s.seq <= dropoffSeq;
              return (
                <li key={s.id} className={`grid grid-cols-[3.5rem_1fr] gap-2 border-l-4 pl-3 ${inSegment ? 'border-brand' : 'border-line'}`}>
                  <span className="font-semibold tabular-nums">{formatTime(s.plannedAt)}</span>
                  <span>
                    <span className="font-medium">{s.label}</span>
                    {s.meetingPoint && <span className="block text-sm text-ink-muted">{s.meetingPoint}</span>}
                    <span className="block text-xs text-ink-muted">
                      {s.seq === 0 ? 'Départ' : `${formatXof(s.priceFromOriginXof)} depuis le départ`}
                      {s.locationPrecision === 'APPROX' && ' · point approximatif'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-ink-muted">Heures de passage estimées, susceptibles de varier selon la circulation.</p>
        </section>

        <section aria-labelledby="info-title" className="card grid gap-2">
          <h2 id="info-title" className="text-lg font-semibold">
            Informations pratiques
          </h2>
          <ul className="grid gap-1 text-sm">
            <li>
              Véhicule : {trip.vehicle.make} {trip.vehicle.model}, {trip.vehicle.color}
              {trip.vehicle.plateNumber && ` · ${trip.vehicle.plateNumber}`}
            </li>
            <li>Bagages : {LUGGAGE_LABEL[trip.luggagePolicy]}</li>
            <li>{trip.acceptanceMode === 'AUTO' ? 'Réservation confirmée immédiatement' : 'Le conducteur accepte chaque demande'}</li>
            <li>Annulation : {trip.cancellationPolicy.label}</li>
            {trip.allowsCash && <li>Paiement en espèces accepté par le conducteur</li>}
          </ul>
          {trip.description && <p className="whitespace-pre-line text-sm">{trip.description}</p>}
          {trip.instructions && <p className="whitespace-pre-line text-sm text-ink-muted">Consignes : {trip.instructions}</p>}
        </section>
      </div>

      <aside className="grid gap-4 lg:sticky lg:top-4">
        <section aria-labelledby="segment-title" className="card grid gap-3">
          <h2 id="segment-title" className="text-lg font-semibold">
            Votre trajet
          </h2>
          <div>
            <label htmlFor="pickup" className="mb-1 block text-sm font-medium">
              Je monte à
            </label>
            <select id="pickup" className="field" value={pickup ?? ''} onChange={(e) => setPickup(e.target.value)}>
              {trip.stops
                .filter((s) => s.isPickup)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatTime(s.plannedAt)} · {s.label}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="dropoff" className="mb-1 block text-sm font-medium">
              Je descends à
            </label>
            <select id="dropoff" className="field" value={dropoff ?? ''} onChange={(e) => setDropoff(e.target.value)}>
              {trip.stops
                .filter((s) => s.isDropoff)
                .map((s) => (
                  <option key={s.id} value={s.id} disabled={s.seq <= pickupSeq}>
                    {formatTime(s.plannedAt)} · {s.label}
                  </option>
                ))}
            </select>
          </div>
          {!validSegment ? (
            <p className="text-sm text-danger">Le point de descente doit venir après le point de montée.</p>
          ) : availability ? (
            <div aria-live="polite">
              <p className="text-2xl font-bold text-brand-strong">{formatXof(availability.unitPriceXof * seats)}</p>
              <p className="text-sm text-ink-muted">
                {seats > 1 ? `${seats} places × ${formatXof(availability.unitPriceXof)}` : 'par place'} ·{' '}
                {availability.seatsAvailable} place{availability.seatsAvailable > 1 ? 's' : ''} libre
                {availability.seatsAvailable > 1 ? 's' : ''} sur ce segment
              </p>
              <p className="mt-1 text-xs text-ink-muted">Les frais de service éventuels seront affichés avant le paiement.</p>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Calcul du prix…</p>
          )}
          <button type="button" className="btn-primary" disabled aria-describedby="book-soon">
            {availability && !enoughSeats ? 'Plus assez de places' : 'Réserver'}
          </button>
          <p id="book-soon" className="text-center text-xs text-ink-muted">
            La réservation et le paiement arrivent à l’étape 7 du développement.
          </p>
        </section>

        {trip.driver && (
          <section aria-labelledby="driver-title" className="card grid gap-2">
            <h2 id="driver-title" className="text-lg font-semibold">
              Conducteur
            </h2>
            <div className="flex items-center gap-3">
              <Avatar name={trip.driver.displayName} url={trip.driver.photoUrl} />
              <div>
                <p className="font-medium">
                  {trip.driver.displayName} <span className="text-sm text-success">✓ vérifié</span>
                </p>
                <p className="text-sm text-ink-muted">
                  {trip.driver.ratingAvg !== null ? `★ ${trip.driver.ratingAvg.toFixed(1)} · ${trip.driver.ratingCount} avis` : 'Pas encore d’avis'} ·{' '}
                  {trip.driver.completedTripsCount} trajet{trip.driver.completedTripsCount > 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <Link href={`/conducteurs/${trip.driver.id}`} className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
              Voir le profil
            </Link>
          </section>
        )}
      </aside>
    </div>
  );
}
