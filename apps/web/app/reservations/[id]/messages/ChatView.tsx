'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReportForm } from '@/components/ReportForm';
import { formatDay, formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { type Conversation, trust } from '@/lib/trust';

const POLL_MS = 10_000;
const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');

/** Messagerie entre le passager et le conducteur d'une réservation. */
export function ChatView({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    trust.conversation(bookingId).then(setConv, (err: unknown) => {
      if (err instanceof ApiRequestError && err.status === 401) router.replace(`/connexion?next=/reservations/${bookingId}/messages`);
      else setError(err instanceof ApiRequestError && err.status === 404 ? 'Conversation introuvable.' : message(err));
    });
  }, [bookingId, router]);

  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => bottom.current?.scrollIntoView?.({ block: 'end' }), [conv?.data.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const m = await trust.sendMessage(bookingId, body);
      setConv((c) => (c ? { ...c, data: [...c.data, m] } : c));
      setText('');
    } catch (err) {
      setError(message(err));
    } finally {
      setSending(false);
    }
  }

  if (!conv) return error ? <p role="alert" className="card mx-auto max-w-2xl text-danger">{error}</p> : <p className="card mx-auto max-w-2xl text-ink-muted">Chargement…</p>;

  const otherName = conv.other.firstName ?? (conv.other.role === 'DRIVER' ? 'Le conducteur' : 'Le passager');
  return (
    <div className="mx-auto grid max-w-2xl gap-3">
      <div>
        <Link href={`/reservations/${bookingId}`} className="text-sm text-brand">
          ← Réservation {conv.reference}
        </Link>
        <h1 className="text-2xl font-bold">Messages avec {otherName}</h1>
        {conv.contactsMasked && conv.canSend && (
          <p className="text-sm text-ink-muted">Les numéros, adresses e-mail et liens sont masqués tant que la réservation n’est pas confirmée.</p>
        )}
      </div>

      <section aria-label="Conversation" aria-live="polite" className="card grid max-h-[60vh] gap-2 overflow-y-auto">
        {conv.data.length === 0 && <p className="text-sm text-ink-muted">Aucun message. Présentez-vous ou précisez le point de rendez-vous.</p>}
        {conv.data.map((m) => (
          <div key={m.id} className={`grid max-w-[85%] gap-0.5 ${m.mine ? 'justify-self-end text-right' : 'justify-self-start'}`}>
            <p className={`rounded-lg px-3 py-2 text-sm ${m.hidden ? 'italic text-ink-muted' : m.mine ? 'bg-brand-soft' : 'bg-surface-muted'}`}>{m.body}</p>
            <p className="text-xs text-ink-muted tabular-nums">
              {m.mine ? 'Vous' : otherName} · {formatDay(m.createdAt)} {formatTime(m.createdAt)}
              {m.wasRedacted && ' · coordonnées masquées'}
              {!m.mine && !m.hidden && (
                <>
                  {' · '}
                  <button type="button" className="underline" onClick={() => setReporting(m.id)}>
                    Signaler
                  </button>
                </>
              )}
            </p>
          </div>
        ))}
        <div ref={bottom} />
      </section>

      {reporting && (
        <ReportForm targetType="MESSAGE" targetId={reporting} bookingId={bookingId} title="Signaler ce message" onDone={() => setReporting(null)} />
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {conv.canSend ? (
        <form onSubmit={(e) => void submit(e)} className="grid gap-2">
          <label htmlFor="chat-text" className="sr-only">
            Votre message
          </label>
          <textarea id="chat-text" rows={2} maxLength={1000} className="field h-auto py-2" value={text} onChange={(e) => setText(e.target.value)} placeholder="Écrire un message…" />
          <button type="submit" className="btn-primary justify-self-end" disabled={sending || !text.trim()}>
            Envoyer
          </button>
        </form>
      ) : (
        <p className="card text-sm text-ink-muted">{conv.closedReason}</p>
      )}
    </div>
  );
}
