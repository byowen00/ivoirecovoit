'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, can, label, type Page, query } from '@/lib/admin';
import { useStaff } from '../_components/AdminShell';
import { Badge, dt, errText, Loading, More, Notice, PageTitle, ReasonAction, Section, Table, useAdmin, usePaged, xof } from '../_components/ui';

interface CommissionRow {
  id: string;
  status: string;
  grossXof: number;
  commissionXof: number;
  serviceFeeXof: number;
  driverNetXof: number;
  adjustedXof: number;
  dueXof: number;
  payableAt: string | null;
  driver: { id: string; displayName: string | null };
  bookingReference: string;
  departureAt: string;
}
interface Payout {
  id: string;
  driver: { id: string; displayName: string | null };
  periodStart: string;
  periodEnd: string;
  amountXof: number;
  status: string;
  method?: string | null;
  externalReference: string | null;
  paidAt: string | null;
  createdAt: string;
  items: number | { amountXof: number; bookingReference: string; payableAt: string }[];
}

const COMMISSION_STATUSES = ['PENDING', 'PAYABLE', 'IN_PAYOUT', 'PAID', 'VOID'];
const PAYOUT_STATUSES = ['DRAFT', 'PAID', 'CANCELLED'];
const METHODS = [['WAVE', 'Wave'], ['ORANGE_MONEY', 'Orange Money'], ['MTN_MOMO', 'MTN MoMo'], ['MOOV_MONEY', 'Moov Money']] as const;
const today = () => new Date().toISOString().slice(0, 10);

export function FinanceView() {
  const me = useStaff();
  const [cStatus, setCStatus] = useState('PAYABLE');
  const [pStatus, setPStatus] = useState('DRAFT');
  const [until, setUntil] = useState(today);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [open, setOpen] = useState<string | null>(null);
  const commissions = usePaged(
    (cursor) => adminCall<Page<CommissionRow> & { totals: Record<string, { dueXof: number; commissionXof: number }> }>(`commissions${query({ status: cStatus, cursor, limit: 30 })}`),
    [cStatus],
  );
  const totals = useAdmin(() => adminCall<{ totals: Record<string, { dueXof: number; commissionXof: number }> }>('commissions?limit=1'), []);
  const payouts = usePaged((cursor) => adminCall<Page<Payout>>(`payouts${query({ status: pStatus, cursor, limit: 30 })}`), [pStatus]);
  const writer = can(me, 'finance.payouts');

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setMsg({});
    try {
      const r = await adminCall<{ created: number }>('payouts/generate', 'POST', { until });
      setMsg({ ok: r.created ? `${r.created} relevé(s) de versement préparé(s).` : 'Aucun gain disponible à verser jusqu’à cette date.' });
      payouts.reload();
      commissions.reload();
      totals.reload();
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }
  const refresh = () => {
    payouts.reload();
    commissions.reload();
    totals.reload();
  };

  return (
    <>
      <PageTitle title="Commissions et versements" />
      <p className="card text-sm">
        Les versements aux conducteurs ne sont pas automatisés. La plateforme prépare un relevé ; le virement Mobile Money se fait en dehors, puis vous
        l’enregistrez ici avec sa référence. Aucun versement n’est marqué payé sans référence.
      </p>
      <Notice ok={msg.ok} error={msg.error} />

      <Section title="Totaux par statut">
        {!totals.data ? (
          <Loading error={totals.error} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {COMMISSION_STATUSES.map((s) => (
              <div key={s} className="rounded border border-line p-2 text-sm">
                <Badge code={s} />
                <p className="mt-1 font-semibold tabular-nums">{xof(totals.data!.totals[s]?.dueXof ?? 0)}</p>
                <p className="text-xs text-ink-muted">dû aux conducteurs · commission {xof(totals.data!.totals[s]?.commissionXof ?? 0)}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Gains par réservation"
        actions={
          <select aria-label="Statut des gains" className="field w-auto" value={cStatus} onChange={(e) => setCStatus(e.target.value)}>
            <option value="">Tous</option>
            {COMMISSION_STATUSES.map((s) => (
              <option key={s} value={s}>{label(s)}</option>
            ))}
          </select>
        }
      >
        {!commissions.rows ? (
          <Loading error={commissions.error} />
        ) : (
          <Table
            rows={commissions.rows}
            rowKey={(r) => r.id}
            empty="Aucun gain avec ce statut."
            columns={[
              { label: 'Réservation', render: (r) => <>{r.bookingReference}<span className="block text-xs text-ink-muted">{dt(r.departureAt)}</span></> },
              { label: 'Conducteur', render: (r) => <Link href={`/admin/utilisateurs/${r.driver.id}`} className="text-brand">{r.driver.displayName ?? '—'}</Link> },
              { label: 'Statut', render: (r) => <><Badge code={r.status} />{r.payableAt && <span className="block text-xs text-ink-muted">dès {dt(r.payableAt)}</span>}</> },
              { label: 'Brut', render: (r) => xof(r.grossXof), className: 'text-right tabular-nums' },
              { label: 'Commission', render: (r) => xof(r.commissionXof), className: 'text-right tabular-nums' },
              { label: 'Ajust.', render: (r) => xof(r.adjustedXof), className: 'text-right tabular-nums' },
              { label: 'Dû', render: (r) => xof(r.dueXof), className: 'text-right font-semibold tabular-nums' },
            ]}
          />
        )}
        <More next={commissions.next} onMore={commissions.more} />
      </Section>

      <Section
        title="Relevés de versement"
        actions={
          <select aria-label="Statut des relevés" className="field w-auto" value={pStatus} onChange={(e) => setPStatus(e.target.value)}>
            <option value="">Tous</option>
            {PAYOUT_STATUSES.map((s) => (
              <option key={s} value={s}>{label(s)}</option>
            ))}
          </select>
        }
      >
        {writer && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void generate(e)}>
            <label className="grid gap-1 text-sm">
              <span>Gains disponibles jusqu’au</span>
              <input type="date" className="field" value={until} max={today()} onChange={(e) => setUntil(e.target.value)} required />
            </label>
            <button type="submit" className="btn-secondary">Préparer les relevés</button>
          </form>
        )}
        {!payouts.rows ? (
          <Loading error={payouts.error} />
        ) : (
          <Table
            rows={payouts.rows}
            rowKey={(r) => r.id}
            empty="Aucun relevé."
            columns={[
              { label: 'Conducteur', render: (r) => r.driver.displayName ?? '—' },
              { label: 'Période', render: (r) => `${dt(r.periodStart)} → ${dt(r.periodEnd)}` },
              { label: 'Statut', render: (r) => <><Badge code={r.status} />{r.externalReference && <span className="block text-xs text-ink-muted">Réf. {r.externalReference} · {dt(r.paidAt)}</span>}</> },
              { label: 'Montant', render: (r) => xof(r.amountXof), className: 'text-right font-semibold tabular-nums' },
              {
                label: 'Actions',
                render: (r) => (
                  <div className="grid gap-2">
                    <button type="button" className="text-left text-sm font-semibold text-brand" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      {open === r.id ? 'Masquer le détail' : `Détail (${typeof r.items === 'number' ? r.items : r.items.length})`}
                    </button>
                    {open === r.id && <PayoutItems id={r.id} />}
                    {writer && r.status === 'DRAFT' && (
                      <>
                        <MarkPaid id={r.id} onDone={() => { setMsg({ ok: 'Versement enregistré comme payé.' }); refresh(); }} />
                        <ReasonAction label="Annuler le relevé" danger run={(reason) => adminCall(`payouts/${r.id}/cancel`, 'POST', { reason })} onDone={() => { setMsg({ ok: 'Relevé annulé : les gains redeviennent disponibles.' }); refresh(); }} />
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
        <More next={payouts.next} onMore={payouts.more} />
      </Section>
    </>
  );
}

function PayoutItems({ id }: { id: string }) {
  const { data, error } = useAdmin(() => adminCall<Payout>(`payouts/${id}`), [id]);
  if (!data) return <Loading error={error} />;
  const items = Array.isArray(data.items) ? data.items : [];
  return (
    <ul className="text-xs">
      {items.map((i) => (
        <li key={i.bookingReference}>
          {i.bookingReference} · {xof(i.amountXof)}
        </li>
      ))}
    </ul>
  );
}

function MarkPaid({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState('');
  const [method, setMethod] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        Enregistrer le virement
      </button>
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await adminCall(`payouts/${id}/mark-paid`, 'POST', method ? { externalReference: ref.trim(), method } : { externalReference: ref.trim() });
      setOpen(false);
      onDone();
    } catch (err) {
      setError(errText(err));
    }
  }
  return (
    <form className="grid gap-2 rounded border border-line p-2" onSubmit={(e) => void submit(e)} aria-label="Enregistrer le virement">
      <label className="grid gap-1 text-sm">
        <span>Référence du virement (chez l’opérateur)</span>
        <input className="field" value={ref} onChange={(e) => setRef(e.target.value)} required minLength={3} maxLength={100} />
      </label>
      <select aria-label="Opérateur" className="field" value={method} onChange={(e) => setMethod(e.target.value)}>
        <option value="">Opérateur (facultatif)</option>
        {METHODS.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={ref.trim().length < 3}>Confirmer</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </form>
  );
}
