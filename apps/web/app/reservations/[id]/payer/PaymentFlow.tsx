'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { type Booking, bookings } from '@/lib/bookings';
import { formatXof } from '@/lib/format';
import { isCiMobile, METHOD_LABEL, type MobileMoneyMethod, type NextAction, type Payment, type PaymentMethods, paymentOutcome, payments } from '@/lib/payments';
import { newIdempotencyKey } from '@/lib/trips';
import { useNow } from '@/lib/use-now';

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');
const POLL_MS = 3000;

function countdown(ms: number): string {
  if (ms <= 0) return 'délai dépassé';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/**
 * Écran 9 (Paiement) : moyen et numéro payeur, attente de la validation sur le téléphone, résultat.
 * Le résultat affiché vient toujours du serveur (GET /payments/:id), jamais du retour de la page de l'opérateur.
 */
export function PaymentFlow({ bookingId, paymentId }: { bookingId: string; paymentId: string | null }) {
  const router = useRouter();
  const now = useNow();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [action, setAction] = useState<NextAction | null>(null);
  const [method, setMethod] = useState<MobileMoneyMethod | null>(null);
  const [phone, setPhone] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Après « Réessayer », le paiement de l'adresse (retour de la page de l'opérateur) n'est plus suivi.
  const [fromUrl, setFromUrl] = useState(paymentId);

  const loadBooking = useCallback(
    () =>
      bookings.get(bookingId).then(setBooking, (err: unknown) => {
        if (err instanceof ApiRequestError && err.status === 401) router.replace(`/connexion?next=/reservations/${bookingId}/payer`);
        else setError(err instanceof ApiRequestError && err.status === 404 ? 'Réservation introuvable.' : message(err));
      }),
    [bookingId, router],
  );

  useEffect(() => {
    void loadBooking();
    payments.methods().then(setMethods, (err: unknown) => setError(message(err)));
  }, [loadBooking]);

  // Paiement à suivre : celui de l'adresse (retour de la page de paiement) ou le dernier en cours.
  const followId = payment?.id ?? fromUrl ?? (booking?.payment && ['CREATED', 'PENDING'].includes(booking.payment.status) ? booking.payment.id : null);
  useEffect(() => {
    if (!followId || payment) return;
    payments.get(followId).then(setPayment, () => undefined);
  }, [followId, payment]);

  // Interrogation du serveur tant que le paiement est en attente.
  const waiting = payment !== null && (payment.status === 'CREATED' || payment.status === 'PENDING');
  useEffect(() => {
    if (!waiting || !payment) return;
    const timer = setInterval(() => {
      payments.get(payment.id).then((p) => {
        setPayment(p);
        if (p.status !== 'CREATED' && p.status !== 'PENDING') void loadBooking();
      }, () => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, payment, loadBooking]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!method) return setError('Choisissez un moyen de paiement.');
    if (!isCiMobile(phone)) return setError('Numéro mobile ivoirien attendu (10 chiffres, par exemple 07 07 07 07 07).');
    setBusy(true);
    setError(null);
    try {
      const p = await payments.initiate(bookingId, { method, payerPhone: phone }, key);
      setPayment(p);
      setAction(p.nextAction ?? null);
    } catch (err) {
      setError(message(err));
      void loadBooking();
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    setFromUrl(null);
    setPayment(null);
    setAction(null);
    setKey(newIdempotencyKey());
    router.replace(`/reservations/${bookingId}/payer`);
    void loadBooking();
  }

  if (!booking || !methods) {
    return error ? <p role="alert" className="card mx-auto max-w-xl text-danger">{error}</p> : <p className="card mx-auto max-w-xl text-ink-muted">Chargement…</p>;
  }

  const holdLeft = booking.holdExpiresAt ? new Date(booking.holdExpiresAt).getTime() - now : 0;
  const holdOpen = holdLeft > 0;
  const outcome = payment ? paymentOutcome(payment, holdOpen && booking.status === 'PENDING_PAYMENT') : null;

  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <div>
        <Link href={`/reservations/${bookingId}`} className="text-sm text-brand">
          ← Ma réservation
        </Link>
        <h1 className="text-2xl font-bold">Paiement</h1>
        <p className="text-ink-muted">
          {booking.pickup.label} → {booking.dropoff.label} · Réf. {booking.reference}
        </p>
      </div>

      {methods.sandbox && (
        <p role="note" className="card bg-warning-soft text-sm">
          Bac à sable : aucun argent réel n’est débité. La validation se fait sur une page de paiement simulée.
        </p>
      )}

      <section className="card flex items-center justify-between" aria-label="Montant à payer">
        <span>Total à payer</span>
        <strong className="text-xl tabular-nums text-brand-strong">{formatXof(booking.totalXof)}</strong>
      </section>

      {error && (
        <p role="alert" className="card text-danger">
          {error}
        </p>
      )}

      {!payment && booking.actions.canPay && (
        <form onSubmit={(e) => void submit(e)} className="card grid gap-3" noValidate>
          <p className="text-sm" role="timer">
            Places bloquées encore <strong className="tabular-nums">{countdown(holdLeft)}</strong>.
          </p>
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-semibold">Moyen de paiement</legend>
            {methods.methods.length === 0 && <p className="text-sm text-danger">Aucun moyen de paiement n’est disponible pour le moment.</p>}
            {methods.methods.map((m) => (
              <label key={m.code} className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line px-3">
                <input type="radio" name="method" value={m.code} checked={method === m.code} onChange={() => setMethod(m.code)} />
                <span>{m.label}</span>
              </label>
            ))}
          </fieldset>
          <label htmlFor="payer-phone" className="font-semibold">
            Numéro qui paie
          </label>
          <input
            id="payer-phone"
            className="field"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="07 07 07 07 07"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <p className="text-xs text-ink-muted">
            Vous validerez le paiement sur ce téléphone, chez votre opérateur. IvoireCovoit ne vous demandera jamais votre code secret Mobile Money.
          </p>
          <button type="submit" className="btn-primary" disabled={busy || !holdOpen || methods.methods.length === 0}>
            {busy ? 'Envoi…' : `Payer ${formatXof(booking.totalXof)}`}
          </button>
        </form>
      )}

      {!payment && !booking.actions.canPay && (
        <p className="card text-sm">
          {booking.status === 'CONFIRMED' ? 'Cette réservation est déjà confirmée.' : 'Cette réservation n’attend pas de paiement.'}{' '}
          <Link href={`/reservations/${bookingId}`} className="font-semibold text-brand">
            Voir la réservation
          </Link>
        </p>
      )}

      {payment && outcome?.kind === 'waiting' && (
        <section className="card grid gap-3" aria-live="polite">
          <h2 className="text-lg font-semibold">En attente de validation</h2>
          <p className="text-sm">
            {METHOD_LABEL[payment.method]} · {payment.payerPhoneMasked} · {formatXof(payment.amountXof)}
          </p>
          {action?.type === 'REDIRECT' && action.url ? (
            <>
              <p className="text-sm">{action.instructions}</p>
              <a className="btn-primary" href={action.url}>
                {payment.sandbox ? 'Ouvrir la page de paiement simulée' : 'Continuer chez l’opérateur'}
              </a>
            </>
          ) : (
            <p className="text-sm">{action?.instructions ?? 'Validez le paiement sur votre téléphone. Cette page se met à jour toute seule.'}</p>
          )}
          <p className="text-sm text-ink-muted" role="timer">
            Délai restant : <span className="tabular-nums">{countdown(new Date(payment.expiresAt).getTime() - now)}</span>. Ne fermez pas cette page si vous le pouvez ; sinon,
            retrouvez le résultat dans votre réservation.
          </p>
        </section>
      )}

      {payment && outcome?.kind === 'confirmed' && (
        <section className="card grid gap-2" role="status">
          <h2 className="text-lg font-semibold text-success">Paiement confirmé</h2>
          <p className="text-sm">
            {formatXof(payment.amountXof)} payés avec {METHOD_LABEL[payment.method]}. Votre réservation est confirmée.
          </p>
          <Link href={`/reservations/${bookingId}`} className="btn-primary">
            Voir ma réservation
          </Link>
        </section>
      )}

      {payment && outcome?.kind === 'late' && (
        <section className="card grid gap-2" role="status">
          <h2 className="text-lg font-semibold">Paiement reçu trop tard</h2>
          <p className="text-sm">{outcome.text}</p>
          <Link href="/paiements" className="font-semibold text-brand">
            Suivre le remboursement
          </Link>
        </section>
      )}

      {payment && outcome?.kind === 'failed' && (
        <section className="card grid gap-2" role="alert">
          <h2 className="text-lg font-semibold text-danger">Paiement non abouti</h2>
          <p className="text-sm">{outcome.text}</p>
          {outcome.canRetry ? (
            <button type="button" className="btn-primary" onClick={retry}>
              Réessayer
            </button>
          ) : (
            <Link href={`/reservations/${bookingId}`} className="font-semibold text-brand">
              Voir la réservation
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
