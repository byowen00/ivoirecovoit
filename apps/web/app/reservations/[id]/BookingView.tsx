'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BookingStatusBadge } from '@/components/BookingStatusBadge';
import { formatDay, formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { type Booking, BOOKING_STATUS_LABEL, bookings, type CancelPreview, refundText } from '@/lib/bookings';
import { formatXof } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/trips';
import { useNow } from '@/lib/use-now';

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');

function remaining(ms: number): string {
  if (ms <= 0) return 'délai dépassé';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(s).padStart(2, '0')} s`;
}

const BY_LABEL = { PASSENGER: 'passager', DRIVER: 'conducteur', SYSTEM: 'automatique', STAFF: 'IvoireCovoit' } as const;

/** Écran 12 (détail) : statut, échéance, montants, annulation ; pour le conducteur, acceptation ou refus. */
export function BookingView({ id }: { id: string }) {
  const router = useRouter();
  const now = useNow();
  const [b, setB] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelPanel, setCancelPanel] = useState<CancelPreview | null>(null);

  const load = useCallback(() => {
    bookings.get(id).then(setB, (err: unknown) => {
      if (err instanceof ApiRequestError && err.status === 401) router.replace(`/connexion?next=/reservations/${id}`);
      else setError(err instanceof ApiRequestError && err.status === 404 ? 'Réservation introuvable.' : message(err));
    });
  }, [id, router]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<Booking>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setB(await fn());
      setNotice(done);
    } catch (err) {
      setError(message(err));
      load();
    } finally {
      setBusy(false);
    }
  }

  async function openCancel() {
    setError(null);
    try {
      setCancelPanel(await bookings.cancelPreview(id));
    } catch (err) {
      setError(message(err));
    }
  }

  if (!b) return error ? <p role="alert" className="card mx-auto max-w-2xl text-danger">{error}</p> : <p className="card mx-auto max-w-2xl text-ink-muted">Chargement…</p>;

  const isDriver = b.viewerRole === 'DRIVER';
  const holdLeft = b.holdExpiresAt ? new Date(b.holdExpiresAt).getTime() - now : null;

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div>
        <Link href={isDriver ? `/conducteur/trajets/${b.trip.id}` : '/reservations'} className="text-sm text-brand">
          ← {isDriver ? 'Gérer le trajet' : 'Mes réservations'}
        </Link>
        <h1 className="text-2xl font-bold">
          {b.pickup.label} → {b.dropoff.label}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-ink-muted">
          <BookingStatusBadge status={b.status} role={b.viewerRole} /> Réf. {b.reference}
          {b.isDemo && <span className="rounded bg-warning-soft px-1 text-xs text-ink">[DEMO]</span>}
        </p>
      </div>

      {notice && <p role="status" className="card text-success">{notice}</p>}
      {error && <p role="alert" className="card text-danger">{error}</p>}

      <StatusPanel b={b} holdLeft={holdLeft} />

      {isDriver && (b.actions.canAccept || b.actions.canReject) && (
        <div className="flex flex-wrap gap-2">
          {b.actions.canAccept && (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => bookings.accept(b.id), 'Demande acceptée : le passager a été prévenu.')}>
              Accepter
            </button>
          )}
          {b.actions.canReject && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void act(() => bookings.reject(b.id), 'Demande refusée : les places sont libérées.')}>
              Refuser
            </button>
          )}
        </div>
      )}

      <section className="card grid gap-2" aria-labelledby="trip-title">
        <h2 id="trip-title" className="text-lg font-semibold">
          Trajet
        </h2>
        <p className="text-sm text-ink-muted">{formatDay(b.pickup.plannedAt)}</p>
        <p>
          <strong className="tabular-nums">{formatTime(b.pickup.plannedAt)}</strong> {b.pickup.label}
          {b.pickup.meetingPoint && <span className="block text-sm text-ink-muted">{b.pickup.meetingPoint}</span>}
        </p>
        <p>
          <strong className="tabular-nums">{formatTime(b.dropoff.plannedAt)}</strong> {b.dropoff.label}
        </p>
        <p className="text-xs text-ink-muted">Heures de passage estimées.</p>
        <p className="text-sm">
          {isDriver ? `Passager : ${b.passenger.displayName ?? 'Passager'}` : `Conducteur : ${b.trip.driver.displayName ?? '—'}`} · {b.trip.vehicle.make}{' '}
          {b.trip.vehicle.model}, {b.trip.vehicle.color}
          {b.trip.vehicle.plateNumber ? ` · ${b.trip.vehicle.plateNumber}` : ''}
        </p>
        {!b.trip.vehicle.plateNumber && !isDriver && <p className="text-xs text-ink-muted">L’immatriculation s’affiche une fois la réservation confirmée.</p>}
        <Link href={`/trajets/${b.trip.id}`} className="text-sm font-semibold text-brand">
          Voir le trajet
        </Link>
      </section>

      <section className="card grid gap-1 text-sm" aria-labelledby="amounts-title">
        <h2 id="amounts-title" className="mb-1 text-lg font-semibold">
          Montants
        </h2>
        <p className="flex justify-between">
          <span>
            {formatXof(b.unitPriceXof)} × {b.seats} place{b.seats > 1 ? 's' : ''}
          </span>
          <span className="tabular-nums">{formatXof(b.subtotalXof)}</span>
        </p>
        <p className="flex justify-between">
          <span>Frais de service</span>
          <span className="tabular-nums">{formatXof(b.serviceFeeXof)}</span>
        </p>
        <p className="flex justify-between border-t border-line pt-1 font-bold">
          <span>Total passager</span>
          <span className="tabular-nums">{formatXof(b.totalXof)}</span>
        </p>
        {isDriver && b.driverNetXof !== undefined && (
          <p className="flex justify-between text-ink-muted">
            <span>Pour vous, après commission ({formatXof(b.commissionXof ?? 0)})</span>
            <span className="tabular-nums">{formatXof(b.driverNetXof)}</span>
          </p>
        )}
        <p className="mt-2 text-ink-muted">
          Annulation ({b.cancellationPolicy.label}) : {b.cancellationPolicy.summary}
        </p>
      </section>

      {b.actions.canCancel && !cancelPanel && (
        <button type="button" className="btn-danger justify-self-start" onClick={() => void openCancel()}>
          {isDriver ? 'Annuler cette réservation' : 'Annuler ma réservation'}
        </button>
      )}
      {cancelPanel && (
        <CancelPanel
          preview={cancelPanel}
          isDriver={isDriver}
          busy={busy}
          onClose={() => setCancelPanel(null)}
          onConfirm={(reason, key) =>
            void act(async () => {
              const res = await bookings.cancel(b.id, reason, key);
              setCancelPanel(null);
              return res.booking;
            }, 'Réservation annulée.')
          }
        />
      )}

      <section className="card" aria-labelledby="history-title">
        <h2 id="history-title" className="mb-2 text-lg font-semibold">
          Historique
        </h2>
        <ol className="grid gap-1 text-sm">
          {b.history.map((h, i) => (
            <li key={i}>
              <span className="tabular-nums text-ink-muted">
                {formatDay(h.at)} {formatTime(h.at)}
              </span>{' '}
              · {BOOKING_STATUS_LABEL[h.to]} ({BY_LABEL[h.by]}){h.reason ? ` : ${h.reason}` : ''}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function StatusPanel({ b, holdLeft }: { b: Booking; holdLeft: number | null }) {
  const isDriver = b.viewerRole === 'DRIVER';
  const until = (iso: string) => `${formatDay(iso)} à ${formatTime(iso)}`;
  let text: React.ReactNode = null;
  switch (b.status) {
    case 'PENDING_ACCEPTANCE':
      text = isDriver ? (
        <>Répondez avant le {b.acceptanceDeadline && until(b.acceptanceDeadline)} ({holdLeft !== null && remaining(holdLeft)}) : sans réponse, la demande expire.</>
      ) : (
        <>
          Demande envoyée à {b.trip.driver.displayName ?? 'votre conducteur'}. Réponse au plus tard le {b.acceptanceDeadline && until(b.acceptanceDeadline)}. Vos places
          sont réservées en attendant.
        </>
      );
      break;
    case 'PENDING_PAYMENT':
      text = (
        <>
          {isDriver ? 'Le passager doit payer' : 'Places bloquées'} jusqu’à {b.holdExpiresAt && formatTime(b.holdExpiresAt)} ({holdLeft !== null && remaining(holdLeft)}).{' '}
          {!isDriver &&
            'Le paiement mobile (Wave, Orange Money, MTN MoMo, Moov Money) n’est pas encore disponible dans cette version : sans paiement, la réservation expirera et les places seront libérées.'}
        </>
      );
      break;
    case 'CONFIRMED':
      text =
        b.paymentStatus === 'CASH_DUE'
          ? isDriver
            ? `Réservation confirmée, paiement en espèces à recevoir le jour du trajet.`
            : `Réservation confirmée. Vous réglerez ${formatXof(b.subtotalXof)} en espèces au conducteur.`
          : 'Réservation confirmée.';
      break;
    case 'EXPIRED':
      text = isDriver ? 'Réservation expirée.' : 'Délai dépassé : la réservation a expiré et les places ont été libérées. Rien ne vous a été débité.';
      break;
    case 'REJECTED':
      text = isDriver ? 'Demande refusée.' : 'Le conducteur n’a pas pu accepter votre demande. Rien ne vous a été débité.';
      break;
    case 'NO_SHOW':
      text = 'Absence constatée par le conducteur.';
      break;
    case 'COMPLETED':
      text = 'Trajet effectué.';
      break;
    default:
      text = (
        <>
          {b.cancellationReason && `Motif : ${b.cancellationReason}. `}
          {b.refundDueXof
            ? `Remboursement prévu : ${formatXof(b.refundDueXof)}. Les remboursements seront traités avec le paiement mobile (prochaine étape du développement).`
            : 'Aucun remboursement n’est dû.'}
        </>
      );
  }
  const urgent = holdLeft !== null && holdLeft > 0 && holdLeft < 5 * 60_000 && b.status.startsWith('PENDING');
  return (
    <p role="status" className={`card text-sm ${urgent ? 'bg-warning-soft' : ''}`}>
      {text}
      {b.freeCancellation && b.actions.canCancel && !isDriver && (
        <span className="mt-1 block font-medium">Le trajet a été modifié : vous pouvez annuler sans frais jusqu’au départ.</span>
      )}
    </p>
  );
}

function CancelPanel({
  preview,
  isDriver,
  busy,
  onClose,
  onConfirm,
}: {
  preview: CancelPreview;
  isDriver: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string, key: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [key] = useState(newIdempotencyKey);
  return (
    <div className="card grid gap-3" aria-label="Annuler la réservation">
      <p className="text-sm">{refundText(preview, formatXof)}</p>
      {!isDriver && preview.driverCompensationXof > 0 && (
        <p className="text-xs text-ink-muted">La part non remboursée revient au conducteur, qui vous avait réservé ces places.</p>
      )}
      <label htmlFor="cancel-reason" className="text-sm font-medium">
        Motif {isDriver ? '(visible du passager)' : ''}
      </label>
      <textarea id="cancel-reason" rows={2} maxLength={300} className="field h-auto py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => onConfirm(reason.trim(), key)}>
          Confirmer l’annulation
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Garder la réservation
        </button>
      </div>
    </div>
  );
}
