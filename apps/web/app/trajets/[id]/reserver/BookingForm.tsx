'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatDay, formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { bookings, type Quote } from '@/lib/bookings';
import { formatXof } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/trips';

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');

/** Écran 8 : places, montée et descente, récapitulatif des montants, conditions d'annulation. */
export function BookingForm({ tripId }: { tripId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const pickupStopId = params.get('pickup') ?? '';
  const dropoffStopId = params.get('dropoff') ?? '';
  const [seats, setSeats] = useState(Math.min(4, Math.max(1, Number(params.get('seats')) || 1)));
  // Devis mémorisé avec son nombre de places : un ancien devis ne s'affiche pas pour un autre choix.
  const [quote, setQuote] = useState<{ seats: number; data: Quote } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [cash, setCash] = useState(false);
  const [busy, setBusy] = useState(false);
  // Une clé par formulaire : un double clic ou une reprise réseau ne crée pas deux réservations.
  const [key] = useState(newIdempotencyKey);
  const here = `/trajets/${tripId}/reserver?pickup=${pickupStopId}&dropoff=${dropoffStopId}&seats=${seats}`;

  useEffect(() => {
    // Lien incomplet : le segment se choisit sur la page du trajet.
    if (!pickupStopId || !dropoffStopId) {
      router.replace(`/trajets/${tripId}`);
      return;
    }
    let live = true;
    bookings.quote({ tripId, pickupStopId, dropoffStopId, seats }).then(
      (data) => live && setQuote({ seats, data }),
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ApiRequestError && err.status === 401) router.replace(`/connexion?next=${encodeURIComponent(here)}`);
        else if (err instanceof ApiRequestError && err.code === 'PROFILE_INCOMPLETE') router.replace(`/inscription/profil?next=${encodeURIComponent(here)}`);
        else setError(message(err));
      },
    );
    return () => {
      live = false;
    };
    // `here` dépend des mêmes valeurs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, pickupStopId, dropoffStopId, seats, router]);

  const q = quote?.seats === seats ? quote.data : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const b = await bookings.create({ tripId, pickupStopId, dropoffStopId, seats, ...(cash ? { paymentMethod: 'CASH' as const } : {}) }, key);
      router.push(`/reservations/${b.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'ALREADY_BOOKED') {
        setError('Vous avez déjà une réservation en cours sur ce trajet. Retrouvez-la dans « Mes réservations ».');
      } else setError(message(err));
      setBusy(false);
    }
  }

  if (!q) {
    return error ? (
      <div className="card mx-auto grid max-w-xl gap-2">
        <p role="alert" className="text-danger">{error}</p>
        <Link href={`/trajets/${tripId}`} className="text-sm font-semibold text-brand">
          ← Retour au trajet
        </Link>
      </div>
    ) : (
      <p className="card mx-auto max-w-xl text-ink-muted">Calcul du prix…</p>
    );
  }

  const maxSeats = Math.min(4, q.seatsAvailable);
  return (
    <form onSubmit={submit} className="mx-auto grid max-w-xl gap-4" aria-labelledby="booking-title">
      <div>
        <Link href={`/trajets/${tripId}?pickup=${pickupStopId}&dropoff=${dropoffStopId}&seats=${seats}`} className="text-sm text-brand">
          ← Retour au trajet
        </Link>
        <h1 id="booking-title" className="text-2xl font-bold">
          Réserver
        </h1>
      </div>

      <section className="card grid gap-2" aria-label="Votre trajet">
        <p className="text-sm text-ink-muted">{formatDay(q.pickup.plannedAt)}</p>
        <p>
          <strong className="tabular-nums">{formatTime(q.pickup.plannedAt)}</strong> {q.pickup.label}
        </p>
        <p>
          <strong className="tabular-nums">{formatTime(q.dropoff.plannedAt)}</strong> {q.dropoff.label}
        </p>
        <p className="text-xs text-ink-muted">Heures de passage estimées.</p>
        <div>
          <label htmlFor="seats" className="mb-1 block text-sm font-medium">
            Nombre de places
          </label>
          <select id="seats" className="field" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
            {Array.from({ length: Math.max(maxSeats, seats) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n} disabled={n > maxSeats}>
                {n} place{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="card grid gap-1" aria-label="Récapitulatif">
        <p className="flex justify-between">
          <span>
            {formatXof(q.unitPriceXof)} × {q.seats} place{q.seats > 1 ? 's' : ''}
          </span>
          <span className="tabular-nums">{formatXof(q.subtotalXof)}</span>
        </p>
        <p className="flex justify-between">
          <span>Frais de service</span>
          <span className="tabular-nums">{formatXof(q.serviceFeeXof)}</span>
        </p>
        <p className="mt-1 flex justify-between border-t border-line pt-2 text-lg font-bold">
          <span>Total</span>
          <span className="tabular-nums text-brand-strong">{formatXof(q.totalXof)}</span>
        </p>
        {q.seatsAvailable < q.seats && <p className="text-sm text-danger">Plus que {q.seatsAvailable} place(s) sur ce segment.</p>}
      </section>

      <section className="card grid gap-2 text-sm" aria-label="Déroulement">
        {q.acceptanceMode === 'MANUAL' ? (
          <p>
            Le conducteur accepte chaque demande. Il a jusqu’au{' '}
            <strong>
              {q.acceptanceDeadline && `${formatDay(q.acceptanceDeadline)} à ${formatTime(q.acceptanceDeadline)}`}
            </strong>{' '}
            pour répondre ; vos places sont réservées en attendant.
          </p>
        ) : (
          <p>Réservation instantanée : vos places sont bloquées {q.holdMinutes} min, le temps de payer.</p>
        )}
        <p className="rounded-[var(--radius-control)] bg-warning-soft px-3 py-2">
          Le paiement mobile (Wave, Orange Money, MTN MoMo, Moov Money) n’est pas encore branché : sans paiement, la réservation expire à la fin du
          délai et les places sont libérées.
        </p>
        {q.cashAllowed && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={cash} onChange={(e) => setCash(e.target.checked)} />
            <span>Payer en espèces au conducteur ({formatXof(q.subtotalXof)}, à régler le jour du trajet)</span>
          </label>
        )}
      </section>

      <section className="card grid gap-2 text-sm" aria-labelledby="policy-title">
        <h2 id="policy-title" className="font-semibold">
          Conditions d’annulation : {q.cancellationPolicy.label}
        </h2>
        <p>{q.cancellationPolicy.summary}</p>
        <label className="flex items-start gap-2 font-medium">
          <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} required />
          <span>J’accepte les conditions d’annulation</span>
        </label>
      </section>

      {error && (
        <p role="alert" className="card text-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={!accepted || busy || q.seatsAvailable < q.seats}>
        {busy ? 'Réservation…' : q.acceptanceMode === 'MANUAL' ? 'Envoyer la demande' : 'Réserver'}
      </button>
    </form>
  );
}
