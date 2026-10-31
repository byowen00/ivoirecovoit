'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayInAbidjan } from '@/components/SearchForm';
import { formatDay, formatTime } from '@/components/TripCard';
import { BookingStatusBadge } from '@/components/BookingStatusBadge';
import { ShareLocation } from '@/components/LiveTrip';
import { type MapPoint, TripMap } from '@/components/TripMap';
import { FieldErrors } from '@/lib/account';
import { ApiRequestError } from '@/lib/api';
import { type BookingStatus, bookings } from '@/lib/bookings';
import { formatDistance, formatDuration, formatXof } from '@/lib/format';
import { driverTrips, LUGGAGE_LABEL, type ManagedTrip, newIdempotencyKey, routeSourceNote, TRIP_STATUS_LABEL } from '@/lib/trips';

const INACTIVE: BookingStatus[] = ['EXPIRED', 'REJECTED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'];

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');

/** Détail d'un trajet côté conducteur : actions selon le statut (publier, modifier, dupliquer, annuler, démarrer, terminer). */
export function ManageTrip({ id }: { id: string }) {
  const router = useRouter();
  const [trip, setTrip] = useState<ManagedTrip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<'edit' | 'cancel' | 'duplicate' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    driverTrips.manage(id).then(setTrip, (err: unknown) => {
      if (err instanceof ApiRequestError && err.status === 401) router.replace(`/connexion?next=/conducteur/trajets/${id}`);
      else setError(err instanceof ApiRequestError && err.status === 404 ? 'Trajet introuvable.' : message(err));
    });
  }, [id, router]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<ManagedTrip>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setTrip(await fn());
      setNotice(done);
      setPanel(null);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function bookingAct(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setTrip(await driverTrips.manage(id));
      setNotice(done);
    } catch (err) {
      setError(message(err));
      load();
    } finally {
      setBusy(false);
    }
  }

  const points = useMemo<MapPoint[]>(
    () =>
      (trip?.stops ?? []).map((s, i, all) => ({ lat: s.lat, lng: s.lng, label: s.label, tone: i === 0 ? 'origin' : i === all.length - 1 ? 'destination' : 'stop' })),
    [trip],
  );

  const active = trip?.bookings.filter((b) => !INACTIVE.includes(b.status)) ?? [];
  const closed = trip?.bookings.filter((b) => INACTIVE.includes(b.status)) ?? [];

  if (!trip) return error ? <p role="alert" className="card text-danger">{error}</p> : <p className="card text-ink-muted">Chargement…</p>;
  const a = trip.actions;

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div>
        <Link href="/conducteur/trajets" className="text-sm text-brand">
          ← Mes trajets
        </Link>
        <h1 className="text-2xl font-bold">
          {trip.stops[0]!.label} → {trip.stops.at(-1)!.label}
        </h1>
        <p className="text-ink-muted">
          {formatDay(trip.departureAt)} à {formatTime(trip.departureAt)} · <strong>{TRIP_STATUS_LABEL[trip.status]}</strong> · Réf. {trip.publicRef}
          {trip.isDemo && <span className="ml-2 rounded bg-warning-soft px-1 text-xs text-ink">[DEMO]</span>}
        </p>
        {trip.cancellationReason && <p className="text-sm">Motif d’annulation : {trip.cancellationReason}</p>}
      </div>

      {notice && <p role="status" className="card text-success">{notice}</p>}
      {error && <p role="alert" className="card text-danger">{error}</p>}

      {trip.status === 'IN_PROGRESS' && <ShareLocation tripId={trip.id} />}

      <div className="flex flex-wrap gap-2">
        {a.canPublish && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => driverTrips.publish(trip.id), 'Trajet publié : il apparaît dans les recherches.')}>
            Publier
          </button>
        )}
        {a.canStart && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => driverTrips.start(trip.id), 'Départ enregistré. Bon voyage !')}>
            Démarrer le trajet
          </button>
        )}
        {a.canComplete && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => driverTrips.complete(trip.id), 'Trajet terminé.')}>
            Terminer le trajet
          </button>
        )}
        {a.canEdit && (
          <button type="button" className="btn-secondary" onClick={() => setPanel(panel === 'edit' ? null : 'edit')}>
            Modifier
          </button>
        )}
        {a.canDuplicate && (
          <button type="button" className="btn-secondary" onClick={() => setPanel(panel === 'duplicate' ? null : 'duplicate')}>
            Dupliquer
          </button>
        )}
        {a.canCancel && (
          <button type="button" className="btn-danger" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>
            Annuler le trajet
          </button>
        )}
        {trip.status !== 'DRAFT' && (
          <Link href={`/trajets/${trip.id}`} className="btn-secondary">
            Voir la page publique
          </Link>
        )}
      </div>

      {panel === 'edit' && <EditPanel trip={trip} onSaved={(t) => (setTrip(t), setPanel(null), setNotice('Modifications enregistrées.'))} onConflict={load} />}
      {panel === 'cancel' && <CancelPanel busy={busy} onConfirm={(reason, key) => void act(() => driverTrips.cancel(trip.id, reason, key), 'Trajet annulé.')} />}
      {panel === 'duplicate' && <DuplicatePanel trip={trip} />}

      <TripMap points={points} route={trip.geometry} label="Carte de l’itinéraire estimé" className="h-60" />
      <p className="text-xs text-ink-muted">
        {formatDistance(trip.estimatedDistanceM)}, {formatDuration(trip.estimatedDurationS)}. {routeSourceNote(trip.routeSource)}
      </p>

      <section className="card" aria-labelledby="stops">
        <h2 id="stops" className="mb-2 text-lg font-semibold">
          Arrêts et prix
        </h2>
        <ol className="grid gap-2">
          {trip.stops.map((s) => (
            <li key={s.id} className="grid grid-cols-[3.5rem_1fr_auto] gap-2">
              <span className="tabular-nums">{formatTime(s.plannedAt)}</span>
              <span>
                {s.label}
                {s.meetingPoint && <span className="block text-sm text-ink-muted">{s.meetingPoint}</span>}
              </span>
              <span className="text-sm">{s.seq === 0 ? '' : formatXof(s.priceFromOriginXof)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card grid gap-1 text-sm" aria-labelledby="details">
        <h2 id="details" className="mb-1 text-lg font-semibold">
          Détails
        </h2>
        <p>
          Véhicule : {trip.vehicle.make} {trip.vehicle.model} · {trip.vehicle.plateNumber}
        </p>
        <p>
          Places : {trip.seatsOccupied} réservée{trip.seatsOccupied > 1 ? 's' : ''} sur {trip.seatsOffered}
        </p>
        <p>{trip.acceptanceMode === 'AUTO' ? 'Acceptation automatique' : 'Acceptation manuelle'} · Bagages : {LUGGAGE_LABEL[trip.luggagePolicy]}</p>
        {trip.description && <p className="whitespace-pre-line">{trip.description}</p>}
        {trip.instructions && <p className="whitespace-pre-line text-ink-muted">Consignes : {trip.instructions}</p>}
      </section>

      <section className="card" aria-labelledby="bookings">
        <h2 id="bookings" className="mb-2 text-lg font-semibold">
          Passagers
        </h2>
        {trip.bookings.length === 0 ? (
          <p className="text-ink-muted">Aucune réservation pour l’instant.</p>
        ) : (
          <>
            {active.length === 0 ? (
              <p className="text-ink-muted">Aucune réservation en cours.</p>
            ) : (
              <ul className="divide-y divide-line">
                {active.map((b) => (
                  <BookingRow key={b.id} b={b} tripId={trip.id} busy={busy} act={bookingAct} />
                ))}
              </ul>
            )}
            {closed.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-ink-muted">Demandes expirées, refusées ou annulées ({closed.length})</summary>
                <ul className="divide-y divide-line">
                  {closed.map((b) => (
                    <BookingRow key={b.id} b={b} tripId={trip.id} busy={busy} act={bookingAct} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}

type ManagedBooking = ManagedTrip['bookings'][number];

/** Une réservation vue du conducteur, avec les actions permises par son statut. */
function BookingRow({ b, tripId, busy, act }: { b: ManagedBooking; tripId: string; busy: boolean; act: (fn: () => Promise<unknown>, done: string) => Promise<void> }) {
  return (
    <li className="grid gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {b.passenger.displayName ?? 'Passager'}
          {b.passenger.ratingAvg !== null && <span className="ml-1 text-sm text-ink-muted">★ {b.passenger.ratingAvg.toFixed(1)}</span>}
        </span>
        <BookingStatusBadge status={b.status} role="DRIVER" />
      </div>
      <p className="text-sm text-ink-muted">
        {b.seats} place{b.seats > 1 ? 's' : ''} · {b.pickup} → {b.dropoff}
        {b.pickupAt && ` · montée à ${formatTime(b.pickupAt)}`} · vous recevrez {formatXof(b.driverNetXof)}
      </p>
      <div className="flex flex-wrap gap-2">
        {b.actions.canAccept && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => bookings.accept(b.id), 'Demande acceptée.')}>
            Accepter
          </button>
        )}
        {b.actions.canReject && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void act(() => bookings.reject(b.id), 'Demande refusée.')}>
            Refuser
          </button>
        )}
        {b.actions.canMarkNoShow && (
          <button
            type="button"
            className="btn-danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Confirmer que ce passager ne s’est pas présenté au point de montée ?'))
                void act(() => bookings.noShow(tripId, b.id), 'Absence enregistrée.');
            }}
          >
            Passager absent
          </button>
        )}
        <Link href={`/reservations/${b.id}`} className="btn-secondary">
          Détail{b.actions.canCancel ? ' et annulation' : ''}
        </Link>
      </div>
    </li>
  );
}

function EditPanel({ trip, onSaved, onConflict }: { trip: ManagedTrip; onSaved: (t: ManagedTrip) => void; onConflict: () => void }) {
  const [seats, setSeats] = useState(trip.seatsOffered);
  const [description, setDescription] = useState(trip.description ?? '');
  const [instructions, setInstructions] = useState(trip.instructions ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await driverTrips.update(trip.id, trip.version, {
          seatsOffered: seats,
          description: description.trim() || null,
          instructions: instructions.trim() || null,
        }),
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'VERSION_CONFLICT') {
        setError('Le trajet a été modifié entre-temps : les informations ont été rechargées, vérifiez puis recommencez.');
        onConflict();
      } else if (err instanceof FieldErrors && Object.values(err.fields).length) setError(Object.values(err.fields).join(' '));
      else setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card grid gap-3" aria-label="Modifier le trajet">
      <p className="text-sm text-ink-muted">
        L’itinéraire et les arrêts se modifient en créant un nouveau trajet (dupliquer). Les places ne peuvent pas descendre sous le nombre déjà réservé.
      </p>
      <div>
        <label htmlFor="e-seats" className="mb-1 block text-sm font-medium">
          Places proposées
        </label>
        <select id="e-seats" className="field" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
          {Array.from({ length: trip.vehicle.seatsCapacity }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n} disabled={n < trip.seatsOccupied}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="e-desc" className="mb-1 block text-sm font-medium">
          Description
        </label>
        <textarea id="e-desc" rows={3} maxLength={1000} className="field h-auto py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label htmlFor="e-instr" className="mb-1 block text-sm font-medium">
          Consignes
        </label>
        <textarea id="e-instr" rows={2} maxLength={500} className="field h-auto py-2" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" className="btn-primary justify-self-start" disabled={busy}>
        {busy ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  );
}

function CancelPanel({ busy, onConfirm }: { busy: boolean; onConfirm: (reason: string, key: string) => void }) {
  const [reason, setReason] = useState('');
  const [key] = useState(newIdempotencyKey);
  return (
    <div className="card grid gap-3" aria-label="Annuler le trajet">
      <label htmlFor="reason" className="text-sm font-medium">
        Motif de l’annulation (visible des passagers, qui seront remboursés intégralement)
      </label>
      <textarea id="reason" rows={2} maxLength={300} className="field h-auto py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="button" className="btn-danger justify-self-start" disabled={busy || reason.trim().length < 5} onClick={() => onConfirm(reason.trim(), key)}>
        Confirmer l’annulation
      </button>
    </div>
  );
}

function DuplicatePanel({ trip }: { trip: ManagedTrip }) {
  const [date, setDate] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [publish, setPublish] = useState(true);
  const [key, setKey] = useState(newIdempotencyKey);
  const [results, setResults] = useState<{ date: string; tripId: string | null; error?: { message: string } }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResults((await driverTrips.duplicate(trip.id, dates, publish, key)).data);
      setDates([]);
      setKey(newIdempotencyKey());
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card grid gap-3" aria-label="Dupliquer le trajet">
      <p className="text-sm text-ink-muted">Même itinéraire, même heure ({formatTime(trip.departureAt)}), même prix, sur d’autres dates (14 au maximum).</p>
      <div className="flex gap-2">
        <label htmlFor="dup-date" className="sr-only">
          Date
        </label>
        <input id="dup-date" type="date" min={todayInAbidjan()} className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          type="button"
          className="btn-secondary"
          disabled={!date || dates.includes(date) || dates.length >= 14}
          onClick={() => {
            setDates([...dates, date].sort());
            setDate('');
          }}
        >
          Ajouter
        </button>
      </div>
      {dates.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {dates.map((d) => (
            <li key={d}>
              <button type="button" className="rounded-full bg-surface-muted px-3 py-1 text-sm" onClick={() => setDates(dates.filter((x) => x !== d))} aria-label={`Retirer le ${d}`}>
                {d.split('-').reverse().join('/')} ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" className="h-5 w-5" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        Publier directement (sinon, brouillons)
      </label>
      <button type="button" className="btn-primary justify-self-start" disabled={busy || dates.length === 0} onClick={() => void run()}>
        {busy ? 'Duplication…' : `Créer ${dates.length || ''} trajet${dates.length > 1 ? 's' : ''}`}
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {results && (
        <ul className="grid gap-1 text-sm" aria-live="polite">
          {results.map((r) => (
            <li key={r.date} className={r.tripId ? 'text-success' : 'text-danger'}>
              {r.date.split('-').reverse().join('/')} :{' '}
              {r.tripId ? <Link href={`/conducteur/trajets/${r.tripId}`} className="underline">créé</Link> : r.error?.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
