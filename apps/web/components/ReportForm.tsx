'use client';

import { useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { REPORT_CATEGORY_LABEL, type ReportCategory, type ReportTarget, trust } from '@/lib/trust';

/** Signalement d'une personne, d'un message, d'un avis ou d'un trajet ; examiné par l'équipe IvoireCovoit. */
export function ReportForm({
  targetType,
  targetId,
  bookingId,
  title,
  onDone,
}: {
  targetType: ReportTarget;
  targetId: string;
  bookingId?: string;
  title: string;
  onDone: () => void;
}) {
  const [category, setCategory] = useState<ReportCategory | ''>('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await trust.report({ targetType, targetId, bookingId, category, description: description.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Envoi impossible. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div role="status" className="card grid gap-2">
        <p className="text-success">Signalement envoyé. Notre équipe l’examine ; vous pouvez suivre son état dans « Aide ».</p>
        <button type="button" className="btn-secondary justify-self-start" onClick={onDone}>
          Fermer
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="card grid gap-2" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-ink-muted">En cas de danger immédiat, appelez d’abord les secours : les numéros sont dans « Aide ».</p>
      <label htmlFor="report-category" className="text-sm font-medium">
        Motif
      </label>
      <select id="report-category" className="field" value={category} onChange={(e) => setCategory(e.target.value as ReportCategory)} required>
        <option value="">Choisir…</option>
        {(Object.keys(REPORT_CATEGORY_LABEL) as ReportCategory[]).map((c) => (
          <option key={c} value={c}>
            {REPORT_CATEGORY_LABEL[c]}
          </option>
        ))}
      </select>
      <label htmlFor="report-description" className="text-sm font-medium">
        Que s’est-il passé ? (10 caractères minimum)
      </label>
      <textarea id="report-description" rows={3} maxLength={2000} className="field h-auto py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-danger" disabled={busy || !category || description.trim().length < 10}>
          Envoyer le signalement
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Annuler
        </button>
      </div>
    </form>
  );
}
