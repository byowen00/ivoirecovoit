'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { formatDay } from '@/components/TripCard';
import { STATUS_LABEL, support, type SupportSummary, type SupportTopic, TOPIC_LABEL } from '@/lib/support';

/** Assistance : écrire à l'équipe et suivre ses demandes. */
export function SupportHome() {
  const router = useRouter();
  const [list, setList] = useState<SupportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: '', topic: 'AUTRE' as SupportTopic, body: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    support.mine().then(
      (r) => setList(r.data),
      (err: unknown) => {
        if (err instanceof ApiRequestError && err.status === 401) router.replace('/connexion?next=/aide/assistance');
        else setError('Assistance indisponible pour le moment.');
      },
    );
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await support.open({ ...form, subject: form.subject.trim(), body: form.body.trim() });
      router.push(`/aide/assistance/${t.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Envoi impossible pour le moment.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div>
        <h1 className="text-2xl font-bold">💬 Assistance</h1>
        <p className="text-ink-muted">Écrivez à l’équipe IvoireCovoit. Pour un problème sur un trajet précis, ouvrez plutôt une réclamation depuis la réservation.</p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="card grid gap-3" aria-label="Nouvelle demande">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Thème</span>
          <select className="field" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value as SupportTopic })}>
            {Object.entries(TOPIC_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Sujet</span>
          <input className="field" maxLength={120} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Votre message</span>
          <textarea rows={4} maxLength={2000} className="field h-auto py-2" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </label>
        <p className="text-xs text-ink-muted">Ne communiquez jamais votre code secret Mobile Money : l’équipe ne vous le demandera pas.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" className="btn-primary justify-self-start" disabled={busy || form.subject.trim().length < 3 || !form.body.trim()}>
          Envoyer à l’équipe
        </button>
      </form>
      <section className="card grid gap-2" aria-labelledby="mine-title">
        <h2 id="mine-title" className="text-lg font-semibold">Mes demandes</h2>
        {list === null ? (
          <p className="text-sm text-ink-muted">Chargement…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-ink-muted">Aucune demande pour le moment.</p>
        ) : (
          <ul className="grid gap-2">
            {list.map((t) => (
              <li key={t.id}>
                <Link href={`/aide/assistance/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line p-3 hover:bg-surface-muted">
                  <span>
                    <span className="font-medium">{t.subject}</span>
                    <span className="block text-xs text-ink-muted">
                      {t.reference} · {TOPIC_LABEL[t.topic]} · {formatDay(t.lastMessageAt)}
                    </span>
                  </span>
                  <span className={`chip ${t.status === 'ANSWERED' ? 'chip-success' : 'chip-neutral'}`}>{STATUS_LABEL[t.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
