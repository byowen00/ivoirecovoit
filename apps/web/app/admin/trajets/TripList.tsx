'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, label, type Page, query } from '@/lib/admin';
import { Badge, Demo, dt, Loading, More, PageTitle, Table, usePaged } from '../_components/ui';

interface TripRow {
  id: string;
  publicRef: string;
  status: string;
  kind: string;
  departureAt: string;
  origin: string;
  destination: string;
  seatsOffered: number;
  seatsBooked: number;
  driver: { id: string; displayName: string | null };
  isDemo: boolean;
}

export function TripList() {
  const [status, setStatus] = useState('');
  const [ref, setRef] = useState('');
  const [search, setSearch] = useState('');
  const list = usePaged((cursor) => adminCall<Page<TripRow>>(`trips${query({ status, q: search, cursor, limit: 30 })}`), [status, search]);
  return (
    <>
      <PageTitle title="Trajets" />
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(ref.trim()); }}>
        <input aria-label="Référence du trajet" className="field max-w-xs" placeholder="Référence (ex. T-…)" value={ref} onChange={(e) => setRef(e.target.value)} />
        <select aria-label="Statut" className="field w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous</option>
          {['PUBLISHED', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-secondary">Rechercher</button>
      </form>
      {!list.rows ? (
        <Loading error={list.error} />
      ) : (
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          columns={[
            { label: 'Réf.', render: (r) => <Link href={`/admin/trajets/${r.id}`} className="font-semibold text-brand">{r.publicRef}<Demo on={r.isDemo} /></Link> },
            { label: 'Trajet', render: (r) => `${r.origin} → ${r.destination}` },
            { label: 'Départ', render: (r) => dt(r.departureAt) },
            { label: 'Conducteur', render: (r) => <Link href={`/admin/utilisateurs/${r.driver.id}`} className="text-brand">{r.driver.displayName ?? '—'}</Link> },
            { label: 'Places', render: (r) => `${r.seatsBooked}/${r.seatsOffered}`, className: 'tabular-nums' },
            { label: 'Statut', render: (r) => <Badge code={r.status} /> },
          ]}
        />
      )}
      <More next={list.next} onMore={list.more} />
    </>
  );
}
