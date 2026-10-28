'use client';

import { useState } from 'react';
import { adminCall } from '@/lib/admin';
import { dt, errText, Section, useAdmin } from './ui';

/** Notes internes du personnel sur un utilisateur, un trajet ou une réservation (jamais visibles des clients). */
export function Notes({ targetType, targetId }: { targetType: 'USER' | 'TRIP' | 'BOOKING'; targetId: string }) {
  const { data, reload } = useAdmin(
    () => adminCall<{ data: { id: string; body: string; author: string | null; createdAt: string }[] }>(`notes?targetType=${targetType}&targetId=${targetId}`),
    [targetType, targetId],
  );
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await adminCall('notes', 'POST', { targetType, targetId, body: body.trim() });
      setBody('');
      reload();
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <Section title="Notes internes">
      <ul className="grid gap-2 text-sm">
        {data?.data.length === 0 && <li className="text-ink-muted">Aucune note.</li>}
        {data?.data.map((n) => (
          <li key={n.id} className="border-l-2 border-line pl-2">
            <p>{n.body}</p>
            <p className="text-xs text-ink-muted">
              {n.author ?? 'Personnel'} · {dt(n.createdAt)}
            </p>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void add(e)} className="grid gap-2">
        <label className="sr-only" htmlFor={`note-${targetId}`}>
          Nouvelle note
        </label>
        <textarea id={`note-${targetId}`} rows={2} maxLength={2000} className="field h-auto py-2" placeholder="Ajouter une note pour l’équipe…" value={body} onChange={(e) => setBody(e.target.value)} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" className="btn-secondary justify-self-start" disabled={body.trim().length < 2}>
          Ajouter la note
        </button>
      </form>
    </Section>
  );
}
