'use client';

import { useState } from 'react';
import { adminCall, can } from '@/lib/admin';
import { useStaff } from '../_components/AdminShell';
import { Badge, Demo, dt, InputError, Loading, Notice, PageTitle, ReasonAction, Section, Table, useAdmin, xof } from '../_components/ui';

interface FeeRule {
  id: string;
  tripKind: 'URBAN' | 'INTERCITY' | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  current: boolean;
  commissionBps: number;
  commissionFixedXof: number;
  commissionMinXof: number;
  commissionMaxXof: number | null;
  serviceFeeBps: number;
  serviceFeeFixedXof: number;
  serviceFeeMinXof: number;
  serviceFeeMaxXof: number | null;
  isDemo: boolean;
}

const KIND: Record<string, string> = { URBAN: 'Urbain', INTERCITY: 'Interurbain' };
const pct = (bps: number) => `${(bps / 100).toLocaleString('fr-FR')} %`;
const bounds = (min: number, max: number | null) => (min || max !== null ? ` (min ${xof(min)}${max !== null ? `, max ${xof(max)}` : ''})` : '');
const now = () => new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);

export function FeeRules() {
  const me = useStaff();
  const list = useAdmin(() => adminCall<{ data: FeeRule[] }>('fee-rules'), []);
  const [ok, setOk] = useState<string | null>(null);
  const [f, setF] = useState({ tripKind: '', effectiveFrom: now(), commission: '', commissionMin: '0', commissionMax: '', service: '', serviceMin: '0', serviceMax: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const bps = (v: string, what: string) => {
    const n = Number(v.replace(',', '.'));
    if (v.trim() === '' || !Number.isFinite(n) || n < 0 || n > 50) throw new InputError(`${what} : pourcentage entre 0 et 50.`);
    return Math.round(n * 100);
  };
  const optional = (v: string) => (v.trim() === '' ? null : Number(v));

  return (
    <>
      <PageTitle title="Frais et commissions" />
      <p className="card text-sm">
        Aucun taux n’est validé commercialement : les règles marquées [DEMO] servent aux essais. Une règle utilisée n’est jamais modifiée ; on crée une nouvelle
        version datée, appliquée aux réservations faites après sa date d’effet.
      </p>
      <Notice ok={ok} />
      {!list.data ? (
        <Loading error={list.error} />
      ) : (
        <Table
          rows={list.data.data}
          rowKey={(r) => r.id}
          empty="Aucune règle."
          columns={[
            { label: 'Trajets', render: (r) => <>{r.tripKind ? KIND[r.tripKind] : 'Tous'}<Demo on={r.isDemo} />{r.current && <span className="ml-1"><Badge code="ACTIVE" /></span>}</> },
            { label: 'Période', render: (r) => `${dt(r.effectiveFrom)} → ${r.effectiveTo ? dt(r.effectiveTo) : '…'}` },
            { label: 'Commission conducteur', render: (r) => `${pct(r.commissionBps)}${r.commissionFixedXof ? ` + ${xof(r.commissionFixedXof)}` : ''}${bounds(r.commissionMinXof, r.commissionMaxXof)}` },
            { label: 'Frais de service passager', render: (r) => `${pct(r.serviceFeeBps)}${r.serviceFeeFixedXof ? ` + ${xof(r.serviceFeeFixedXof)}` : ''}${bounds(r.serviceFeeMinXof, r.serviceFeeMaxXof)}` },
          ]}
        />
      )}
      {can(me, 'settings.fees') && (
        <Section title="Nouvelle version">
          <ReasonAction
            label="Créer une nouvelle règle"
            title="Nouvelle règle de frais"
            run={(reason) =>
              adminCall('fee-rules', 'POST', {
                tripKind: f.tripKind || null,
                effectiveFrom: new Date(f.effectiveFrom).toISOString(),
                commissionBps: bps(f.commission, 'Commission'),
                commissionMinXof: Number(f.commissionMin) || 0,
                commissionMaxXof: optional(f.commissionMax),
                serviceFeeBps: bps(f.service, 'Frais de service'),
                serviceFeeMinXof: Number(f.serviceMin) || 0,
                serviceFeeMaxXof: optional(f.serviceMax),
                reason,
              })
            }
            onDone={() => { setOk('Nouvelle règle enregistrée.'); list.reload(); }}
          >
            <p className="text-sm text-ink-muted">Saisissez les taux validés commercialement ; aucun taux n’est proposé par défaut.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span>Trajets concernés</span>
                <select className="field" value={f.tripKind} onChange={set('tripKind')}>
                  <option value="">Tous</option>
                  <option value="URBAN">Urbains</option>
                  <option value="INTERCITY">Interurbains</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>Prend effet le</span>
                <input type="datetime-local" className="field" value={f.effectiveFrom} onChange={set('effectiveFrom')} />
              </label>
              <label className="grid gap-1 text-sm"><span>Commission (%)</span><input className="field" inputMode="decimal" value={f.commission} onChange={set('commission')} /></label>
              <label className="grid gap-1 text-sm"><span>Frais de service (%)</span><input className="field" inputMode="decimal" value={f.service} onChange={set('service')} /></label>
              <label className="grid gap-1 text-sm"><span>Commission minimum (F CFA)</span><input className="field" inputMode="numeric" value={f.commissionMin} onChange={set('commissionMin')} /></label>
              <label className="grid gap-1 text-sm"><span>Frais minimum (F CFA)</span><input className="field" inputMode="numeric" value={f.serviceMin} onChange={set('serviceMin')} /></label>
              <label className="grid gap-1 text-sm"><span>Commission maximum (vide = sans)</span><input className="field" inputMode="numeric" value={f.commissionMax} onChange={set('commissionMax')} /></label>
              <label className="grid gap-1 text-sm"><span>Frais maximum (vide = sans)</span><input className="field" inputMode="numeric" value={f.serviceMax} onChange={set('serviceMax')} /></label>
            </div>
          </ReasonAction>
        </Section>
      )}
    </>
  );
}
