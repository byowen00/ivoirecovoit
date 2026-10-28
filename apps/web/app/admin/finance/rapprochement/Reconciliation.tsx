'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall } from '@/lib/admin';
import { Badge, dt, errText, Loading, Notice, PageTitle, ReasonAction, Section, Table, useAdmin } from '../../_components/ui';

interface Run {
  id: string;
  provider: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  items?: number;
  openItems?: number;
}
interface Item {
  id: string;
  issue: 'MISSING_INTERNAL' | 'MISSING_PROVIDER' | 'AMOUNT_MISMATCH' | 'STATUS_MISMATCH';
  paymentId: string | null;
  providerReference: string | null;
  details: unknown;
  resolvedAt: string | null;
  resolutionNote: string | null;
}
type RunDetail = Omit<Run, 'items'> & { items: Item[] };

const ISSUE: Record<Item['issue'], string> = {
  MISSING_INTERNAL: 'Chez le prestataire, absent chez nous',
  MISSING_PROVIDER: 'Chez nous, absent chez le prestataire',
  AMOUNT_MISMATCH: 'Montants différents',
  STATUS_MISMATCH: 'Statuts différents',
};
const day = (d: Date) => d.toISOString().slice(0, 10);

export function Reconciliation() {
  const runs = useAdmin(() => adminCall<{ data: Run[] }>('reconciliation/runs'), []);
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 86_400_000)));
  const [to, setTo] = useState(() => day(new Date()));
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg({});
    try {
      const r = await adminCall<RunDetail>('reconciliation/run', 'POST', { from, to });
      setSelected(r);
      setMsg({ ok: r.items.length ? `${r.items.length} écart(s) trouvé(s).` : 'Aucun écart sur la période.' });
      runs.reload();
    } catch (err) {
      setMsg({ error: errText(err) });
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    setMsg({});
    try {
      setSelected(await adminCall<RunDetail>(`reconciliation/runs/${id}`));
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }

  return (
    <>
      <PageTitle title="Rapprochement" />
      <p className="text-sm text-ink-muted">
        Compare nos paiements avec le relevé du prestataire. En bac à sable, le relevé vient du simulateur interne : il ne reflète aucun compte marchand réel.
      </p>
      <Notice ok={msg.ok} error={msg.error} />
      <form className="card flex flex-wrap items-end gap-2" onSubmit={(e) => void run(e)}>
        <label className="grid gap-1 text-sm">
          <span>Du</span>
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Au</span>
          <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} required />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>Lancer le rapprochement</button>
      </form>

      {selected && (
        <Section title={`Rapprochement du ${dt(selected.periodStart)} au ${dt(selected.periodEnd)}`} actions={<Badge code={selected.status} />}>
          <Table
            rows={selected.items}
            rowKey={(i) => i.id}
            empty="Aucun écart."
            columns={[
              { label: 'Écart', render: (i) => ISSUE[i.issue] ?? i.issue },
              { label: 'Paiement', render: (i) => (i.paymentId ? <Link href={`/admin/paiements/${i.paymentId}`} className="text-brand">Ouvrir</Link> : '—') },
              { label: 'Réf. prestataire', render: (i) => i.providerReference ?? '—' },
              { label: 'Détails', render: (i) => <code className="break-all text-xs">{JSON.stringify(i.details)}</code> },
              {
                label: 'Suite',
                render: (i) =>
                  i.resolvedAt ? (
                    <span className="text-xs">Traité le {dt(i.resolvedAt)} : {i.resolutionNote}</span>
                  ) : (
                    <ReasonAction label="Marquer traité" title="Explication de l’écart" run={(note) => adminCall(`reconciliation/items/${i.id}/resolve`, 'POST', { note })} onDone={() => void open(selected.id)} />
                  ),
              },
            ]}
          />
        </Section>
      )}

      <Section title="Historique">
        {!runs.data ? (
          <Loading error={runs.error} />
        ) : (
          <Table
            rows={runs.data.data}
            rowKey={(r) => r.id}
            empty="Aucun rapprochement lancé."
            columns={[
              { label: 'Lancé', render: (r) => <button type="button" className="font-semibold text-brand" onClick={() => void open(r.id)}>{dt(r.createdAt)}</button> },
              { label: 'Période', render: (r) => `${dt(r.periodStart)} → ${dt(r.periodEnd)}` },
              { label: 'Prestataire', render: (r) => r.provider },
              { label: 'Statut', render: (r) => <Badge code={r.status} /> },
              { label: 'Écarts ouverts', render: (r) => `${r.openItems ?? 0} / ${r.items ?? 0}`, className: 'text-right tabular-nums' },
            ]}
          />
        )}
      </Section>
    </>
  );
}
