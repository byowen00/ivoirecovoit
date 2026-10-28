'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { formatDay, formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { formatXof } from '@/lib/format';
import { type Dispute, DISPUTE_DECISION_LABEL, DISPUTE_STATUS_LABEL, trust } from '@/lib/trust';

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');
const FROM = { ME: 'Vous', PASSENGER: 'Passager', DRIVER: 'Conducteur', SUPPORT: 'Équipe IvoireCovoit' } as const;

export function DisputeView({ id }: { id: string }) {
  const router = useRouter();
  const [d, setD] = useState<Dispute | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    trust.dispute(id).then(setD, (err: unknown) => {
      if (err instanceof ApiRequestError && err.status === 401) router.replace(`/connexion?next=/aide/reclamations/${id}`);
      else setError(err instanceof ApiRequestError && err.status === 404 ? 'Réclamation introuvable.' : message(err));
    });
  }, [id, router]);
  useEffect(load, [load]);

  async function reply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setD(await trust.replyDispute(id, text.trim()));
      setText('');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (!d) return error ? <p role="alert" className="card mx-auto max-w-2xl text-danger">{error}</p> : <p className="card mx-auto max-w-2xl text-ink-muted">Chargement…</p>;

  const awaitingMe = d.status === 'AWAITING_RESPONSE' && !d.openedByMe;
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div>
        <Link href="/aide" className="text-sm text-brand">
          ← Aide
        </Link>
        <h1 className="text-2xl font-bold">Réclamation {d.reference}</h1>
        <p className="text-ink-muted">
          {d.route} · {formatDay(d.departureAt)} ·{' '}
          <Link href={`/reservations/${d.bookingId}`} className="text-brand">
            réservation {d.bookingReference}
          </Link>
        </p>
      </div>
      <p role="status" className={`card text-sm ${awaitingMe ? 'bg-warning-soft' : ''}`}>
        <strong>{DISPUTE_STATUS_LABEL[d.status]}.</strong>{' '}
        {awaitingMe && d.responseDeadline && `Donnez votre version avant le ${formatDay(d.responseDeadline)} à ${formatTime(d.responseDeadline)}.`}
        {d.status === 'AWAITING_RESPONSE' && d.openedByMe && d.responseDeadline && `L’autre partie peut répondre jusqu’au ${formatDay(d.responseDeadline)} ; ensuite notre équipe examine le dossier.`}
      </p>
      {d.decision && (
        <section className="card grid gap-1 text-sm" aria-label="Décision">
          <h2 className="text-lg font-semibold">Décision</h2>
          <p>
            {DISPUTE_DECISION_LABEL[d.decision] ?? d.decision}
            {d.decidedRefundXof ? ` : ${formatXof(d.decidedRefundXof)}` : ''}.
          </p>
          {d.decisionNote && <p className="text-ink-muted">{d.decisionNote}</p>}
          {d.decidedRefundXof ? <p className="text-ink-muted">Le remboursement est versé sur le numéro qui a payé ; son état est visible dans la réservation.</p> : null}
        </section>
      )}
      <section className="card grid gap-2" aria-label="Échanges">
        <h2 className="text-lg font-semibold">{d.reasonLabel}</h2>
        <p className="text-sm">{d.description}</p>
        <p className="text-xs text-ink-muted">
          {d.openedByMe ? 'Ouverte par vous' : 'Ouverte par l’autre partie'} le {formatDay(d.createdAt)}
        </p>
        <ol className="grid gap-2">
          {d.messages.map((m) => (
            <li key={m.id} className="border-t border-line pt-2 text-sm">
              <span className="font-medium">{FROM[m.from]}</span>{' '}
              <span className="text-xs text-ink-muted tabular-nums">
                {formatDay(m.createdAt)} {formatTime(m.createdAt)}
              </span>
              <p>{m.body}</p>
            </li>
          ))}
        </ol>
        {d.canReply && (
          <form onSubmit={(e) => void reply(e)} className="grid gap-2 border-t border-line pt-2">
            <label htmlFor="dispute-reply" className="text-sm font-medium">
              {awaitingMe ? 'Votre version des faits' : 'Ajouter un message'}
            </label>
            <textarea id="dispute-reply" rows={3} maxLength={2000} className="field h-auto py-2" value={text} onChange={(e) => setText(e.target.value)} />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button type="submit" className="btn-primary justify-self-start" disabled={busy || text.trim().length < 2}>
              Envoyer
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
