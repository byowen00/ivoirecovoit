'use client';

import { useState } from 'react';
import { adminCall } from '@/lib/admin';
import { STATUS_LABEL, type SupportStatus, type SupportSummary, type SupportTicket, TOPIC_LABEL } from '@/lib/support';
import { dt, Loading, Notice, PageTitle, Section, useAdmin } from '../_components/ui';

/** File d'assistance : demandes des membres et réponses de l'équipe. */
export function SupportQueue() {
  const [status, setStatus] = useState<SupportStatus | ''>('OPEN');
  const list = useAdmin(() => adminCall<{ data: (SupportSummary & { userName: string | null })[] }>(`support${status ? `?status=${status}` : ''}`), [status]);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <PageTitle title="Assistance" />
      <select aria-label="Statut" className="field w-auto" value={status} onChange={(e) => setStatus(e.target.value as SupportStatus | '')}>
        <option value="OPEN">En attente de l’équipe</option>
        <option value="ANSWERED">Répondues</option>
        <option value="CLOSED">Clôturées</option>
        <option value="">Toutes</option>
      </select>
      {!list.data ? (
        <Loading error={list.error} />
      ) : list.data.data.length === 0 ? (
        <p className="text-sm text-ink-muted">Aucune demande.</p>
      ) : (
        <ul className="grid gap-2">
          {list.data.data.map((t) => (
            <li key={t.id} className="rounded border border-line p-3">
              <button type="button" className="flex w-full flex-wrap justify-between gap-2 text-left" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                <span>
                  <span className="font-medium">{t.subject}</span>
                  <span className="block text-xs text-ink-muted">
                    {t.reference} · {t.userName ?? 'Membre'} · {TOPIC_LABEL[t.topic]} · dernier message {dt(t.lastMessageAt)}
                  </span>
                </span>
                <span className="text-sm">{STATUS_LABEL[t.status]}</span>
              </button>
              {openId === t.id && <Ticket id={t.id} onChange={list.reload} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Ticket({ id, onChange }: { id: string; onChange: () => void }) {
  const t = useAdmin(() => adminCall<SupportTicket>(`support/${id}`), [id]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!t.data) return <Loading error={t.error} />;
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setOk(done);
      setText('');
      t.reload();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Conversation">
      <ol className="grid gap-2">
        {t.data.messages.map((m) => (
          <li key={m.id} className={`rounded px-3 py-2 ${m.fromStaff ? 'bg-brand-soft' : 'bg-surface-muted'}`}>
            <p className="text-xs text-ink-muted">{m.fromStaff ? `Équipe (${m.author})` : 'Membre'} · {dt(m.createdAt)}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      <Notice ok={ok} error={error} />
      <textarea rows={3} maxLength={2000} aria-label="Réponse" className="field h-auto py-2" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy || !text.trim()} onClick={() => void run(() => adminCall(`support/${id}/messages`, 'POST', { body: text.trim() }), 'Réponse envoyée.')}>
          Répondre
        </button>
        <button type="button" className="btn-secondary" disabled={busy || t.data.status === 'CLOSED'} onClick={() => void run(() => adminCall(`support/${id}/close`, 'POST'), 'Demande clôturée.')}>
          Clôturer
        </button>
      </div>
    </Section>
  );
}
