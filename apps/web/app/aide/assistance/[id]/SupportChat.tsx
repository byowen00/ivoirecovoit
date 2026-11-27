'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { formatDay } from '@/components/TripCard';
import { STATUS_LABEL, support, type SupportTicket, TOPIC_LABEL } from '@/lib/support';

const time = new Intl.DateTimeFormat('fr-CI', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Abidjan' });

/** Conversation d'assistance ; actualisée toutes les 20 s tant que la page est ouverte. */
export function SupportChat({ id }: { id: string }) {
  const [t, setT] = useState<SupportTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    support.get(id).then(setT, (err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Demande indisponible.'));
  }, [id]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setT(await support.reply(id, text.trim()));
      setText('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (!t) return <p className="text-ink-muted">{error ?? 'Chargement…'}</p>;
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <Link href="/aide/assistance" className="text-sm font-semibold text-brand">← Mes demandes</Link>
      <div>
        <h1 className="text-xl font-bold">{t.subject}</h1>
        <p className="text-sm text-ink-muted">
          {t.reference} · {TOPIC_LABEL[t.topic]} · {STATUS_LABEL[t.status]}
        </p>
      </div>
      <ol className="grid gap-2" aria-live="polite">
        {t.messages.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2 ${m.fromStaff ? 'justify-self-start bg-surface' : 'justify-self-end bg-brand-soft'}`}>
            <p className="text-xs font-semibold text-ink-muted">
              {m.author} · {formatDay(m.createdAt)} {time.format(new Date(m.createdAt))}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={(e) => void send(e)} className="flex gap-2">
        <label htmlFor="support-msg" className="sr-only">Votre message</label>
        <textarea id="support-msg" rows={2} maxLength={2000} className="field h-auto flex-1 py-2" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn-primary self-end" disabled={busy || !text.trim()}>Envoyer</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {t.status === 'CLOSED' && <p className="text-xs text-ink-muted">Demande clôturée : un nouveau message la rouvre.</p>}
    </div>
  );
}
