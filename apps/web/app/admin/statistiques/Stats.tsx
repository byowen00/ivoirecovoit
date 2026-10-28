'use client';

import { useState } from 'react';
import { adminCall, query } from '@/lib/admin';
import { Loading, PageTitle, Table, useAdmin, xof } from '../_components/ui';

interface StatRow {
  key: string | null;
  bookings: number;
  seats: number;
  trips: number;
  paidXof: number;
  commissionXof: number;
}

const GROUPS = [['period', 'Période'], ['city', 'Ville de départ'], ['route', 'Axe'], ['kind', 'Type de trajet']] as const;
const KIND: Record<string, string> = { URBAN: 'Urbain', INTERCITY: 'Interurbain' };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export function Stats() {
  const [groupBy, setGroupBy] = useState<string>('period');
  const [interval, setStep] = useState('day');
  const [from, setFrom] = useState(() => day(-30));
  const [to, setTo] = useState(() => day(1));
  const { data, error } = useAdmin(
    () => adminCall<{ data: StatRow[] }>(`stats${query({ groupBy, interval: groupBy === 'period' ? interval : undefined, from, to })}`),
    [groupBy, interval, from, to],
  );
  const max = Math.max(1, ...(data?.data.map((r) => r.bookings) ?? [1]));
  const total = data?.data.reduce((s, r) => ({ bookings: s.bookings + r.bookings, paid: s.paid + r.paidXof, commission: s.commission + r.commissionXof }), { bookings: 0, paid: 0, commission: 0 });
  return (
    <>
      <PageTitle title="Statistiques" />
      <p className="text-sm text-ink-muted">Réservations confirmées sur la période (heure d’Abidjan). Les données de démonstration sont incluses si elles existent.</p>
      <div className="card flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span>Regrouper par</span>
          <select className="field" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            {GROUPS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        {groupBy === 'period' && (
          <label className="grid gap-1 text-sm">
            <span>Pas</span>
            <select className="field" value={interval} onChange={(e) => setStep(e.target.value)}>
              <option value="day">Jour</option>
              <option value="week">Semaine</option>
              <option value="month">Mois</option>
            </select>
          </label>
        )}
        <label className="grid gap-1 text-sm"><span>Du</span><input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="grid gap-1 text-sm"><span>Au (exclu)</span><input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          {total && (
            <p className="text-sm">
              Total : <strong>{total.bookings}</strong> réservation(s), <strong>{xof(total.paid)}</strong> encaissés, <strong>{xof(total.commission)}</strong> de commission.
            </p>
          )}
          <Table
            rows={data.data}
            rowKey={(r) => r.key ?? '—'}
            empty="Aucune réservation confirmée sur la période."
            columns={[
              { label: GROUPS.find(([v]) => v === groupBy)?.[1] ?? '', render: (r) => (groupBy === 'kind' ? (KIND[r.key ?? ''] ?? r.key) : (r.key ?? 'Non renseigné')) },
              {
                label: 'Réservations',
                render: (r) => (
                  <div className="flex items-center gap-2">
                    <span className="h-2 rounded bg-brand" style={{ width: `${Math.round((r.bookings / max) * 120)}px` }} aria-hidden />
                    <span className="tabular-nums">{r.bookings}</span>
                  </div>
                ),
              },
              { label: 'Places', render: (r) => r.seats, className: 'text-right tabular-nums' },
              { label: 'Trajets', render: (r) => r.trips, className: 'text-right tabular-nums' },
              { label: 'Encaissé', render: (r) => xof(r.paidXof), className: 'text-right tabular-nums' },
              { label: 'Commission', render: (r) => xof(r.commissionXof), className: 'text-right tabular-nums' },
            ]}
          />
        </>
      )}
    </>
  );
}
