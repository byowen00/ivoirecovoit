'use client';

import { useState } from 'react';
import { adminCall } from '@/lib/admin';
import { dt, errText, Notice, PageTitle } from '../../_components/ui';

interface ExportResult {
  id: string;
  type: string;
  rowCount: number;
  url: string;
  expiresAt: string;
}

const TYPES = [
  ['TRANSACTIONS', 'Transactions (grand livre)'],
  ['BOOKINGS', 'Réservations'],
  ['REFUNDS', 'Remboursements'],
  ['COMMISSIONS', 'Commissions et gains conducteurs'],
] as const;
const day = (d: Date) => d.toISOString().slice(0, 10);

export function Exports() {
  const [type, setType] = useState<string>('TRANSACTIONS');
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => day(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ExportResult[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await adminCall<ExportResult>('exports', 'POST', { type, from, to });
      setDone((d) => [r, ...d]);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle title="Exports CSV" />
      <p className="text-sm text-ink-muted">
        Fichier CSV (séparateur point-virgule, compatible Excel) sans numéro de téléphone. Le lien de téléchargement expire vite et chaque export est journalisé.
      </p>
      <form className="card grid gap-3 sm:grid-cols-4 sm:items-end" onSubmit={(e) => void submit(e)}>
        <label className="grid gap-1 text-sm">
          <span>Contenu</span>
          <select className="field" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>Du</span>
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Au</span>
          <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} required />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>Générer</button>
      </form>
      <Notice error={error} />
      {done.length > 0 && (
        <ul className="card grid gap-2 text-sm">
          {done.map((x) => (
            <li key={x.id}>
              <a href={x.url} className="font-semibold text-brand" target="_blank" rel="noopener noreferrer">
                Télécharger {TYPES.find(([v]) => v === x.type)?.[1] ?? x.type}
              </a>{' '}
              ({x.rowCount} ligne{x.rowCount > 1 ? 's' : ''}, lien valable jusqu’au {dt(x.expiresAt)})
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
