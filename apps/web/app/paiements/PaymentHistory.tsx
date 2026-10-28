'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatDay, formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { formatXof } from '@/lib/format';
import {
  EARNING_STATUS_LABEL,
  type Earnings,
  METHOD_LABEL,
  payments,
  REFUND_REASON_LABEL,
  type Transaction,
  transactionStatusLabel,
} from '@/lib/payments';

type Tab = 'transactions' | 'earnings';
const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');

/** Écran 14 (Historique des paiements) : paiements et remboursements du passager, gains du conducteur. */
export function PaymentHistory({ initialTab }: { initialTab: Tab }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [items, setItems] = useState<Transaction[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 401) router.replace('/connexion?next=/paiements');
    else setError(message(err));
  };

  useEffect(() => {
    if (tab === 'transactions' && items === null) {
      payments.transactions().then((r) => {
        setItems(r.data);
        setCursor(r.nextCursor);
      }, onError);
    }
    if (tab === 'earnings' && earnings === null) payments.earnings().then(setEarnings, onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function more() {
    if (!cursor) return;
    try {
      const r = await payments.transactions(cursor);
      setItems((prev) => [...(prev ?? []), ...r.data]);
      setCursor(r.nextCursor);
    } catch (err) {
      onError(err);
    }
  }

  const tabClass = (t: Tab) =>
    `min-h-11 flex-1 rounded-[var(--radius-control)] px-3 text-sm font-semibold ${tab === t ? 'bg-brand text-white' : 'bg-surface text-ink-muted'}`;

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <h1 className="text-2xl font-bold">Historique des paiements</h1>
      <div role="tablist" aria-label="Historique" className="flex gap-2 rounded-[var(--radius-card)] border border-line p-1">
        <button type="button" role="tab" aria-selected={tab === 'transactions'} className={tabClass('transactions')} onClick={() => setTab('transactions')}>
          Paiements et remboursements
        </button>
        <button type="button" role="tab" aria-selected={tab === 'earnings'} className={tabClass('earnings')} onClick={() => setTab('earnings')}>
          Mes gains
        </button>
      </div>
      {error && (
        <p role="alert" className="card text-danger">
          {error}
        </p>
      )}

      {tab === 'transactions' &&
        (items === null ? (
          <p className="card text-ink-muted">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="card text-ink-muted">Aucun paiement pour le moment.</p>
        ) : (
          <ul className="grid gap-2">
            {items.map((t) => (
              <li key={`${t.kind}-${t.id}`}>
                <Link href={`/reservations/${t.bookingId}`} className="card grid gap-1 hover:ring-2 hover:ring-brand-soft">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong>{t.kind === 'PAYMENT' ? 'Paiement' : 'Remboursement'}</strong>
                    <span className={`tabular-nums font-bold ${t.kind === 'REFUND' ? 'text-success' : ''}`}>
                      {t.kind === 'REFUND' ? '+ ' : ''}
                      {formatXof(t.amountXof)}
                    </span>
                  </span>
                  <span className="text-sm">{t.route}</span>
                  <span className="text-sm text-ink-muted">
                    {formatDay(t.createdAt)} {formatTime(t.createdAt)} · {transactionStatusLabel(t)}
                    {t.method ? ` · ${METHOD_LABEL[t.method]}` : ''}
                    {t.reason ? ` · ${REFUND_REASON_LABEL[t.reason] ?? t.reason}` : ''} · Réf. {t.bookingReference}
                  </span>
                </Link>
              </li>
            ))}
            {cursor && (
              <li>
                <button type="button" className="btn-secondary w-full" onClick={() => void more()}>
                  Voir plus
                </button>
              </li>
            )}
          </ul>
        ))}

      {tab === 'earnings' && (earnings === null ? <p className="card text-ink-muted">Chargement…</p> : <EarningsView e={earnings} />)}
    </div>
  );
}

function EarningsView({ e }: { e: Earnings }) {
  if (e.trips.length === 0) {
    return (
      <p className="card text-ink-muted">
        Aucun gain pour le moment. Les gains apparaissent ici quand un passager a payé sa place sur l’un de vos trajets.
      </p>
    );
  }
  const row = (label: string, value: number, strong = false) => (
    <p className={`flex justify-between ${strong ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatXof(value)}</span>
    </p>
  );
  return (
    <>
      <section className="card grid gap-1 text-sm" aria-label="Totaux">
        {row('Montant payé par les passagers (part trajet)', e.totals.grossXof)}
        {row('Commission IvoireCovoit', e.totals.commissionXof)}
        {row('En attente', e.totals.pendingXof)}
        {row('Disponible', e.totals.payableXof, true)}
        {row('Déjà versé', e.totals.paidXof)}
        {!e.payoutsAvailable && (
          <p className="mt-2 text-ink-muted">
            Les gains deviennent disponibles 48 h après la fin du trajet, sans réclamation en cours. Le versement sur votre compte Mobile Money n’est pas
            encore ouvert : il sera mis en place avec le prestataire de paiement.
          </p>
        )}
      </section>
      <ul className="grid gap-2">
        {e.trips.map((t) => (
          <li key={t.tripId} className="card grid gap-2 text-sm">
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <strong>
                {t.origin} → {t.destination}
              </strong>
              <span className="tabular-nums font-bold">{formatXof(t.dueXof)}</span>
            </span>
            <span className="text-ink-muted">
              {formatDay(t.departureAt)} {formatTime(t.departureAt)} · {t.publicRef}
            </span>
            <ul className="grid gap-1 border-t border-line pt-2">
              {t.bookings.map((b) => (
                <li key={b.reference} className="flex flex-wrap justify-between gap-2">
                  <span>
                    Réf. {b.reference} · {b.seats} place{b.seats > 1 ? 's' : ''} · {EARNING_STATUS_LABEL[b.status]}
                    {b.adjustmentXof !== 0 && b.status !== 'VOID' && ' · annulée par le passager, part conservée'}
                  </span>
                  <span className="tabular-nums" title={`Part trajet ${formatXof(b.grossXof)}, commission ${formatXof(b.commissionXof)}`}>
                    {formatXof(b.dueXof)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}
