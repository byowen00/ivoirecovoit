'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, label, type Page, query } from '@/lib/admin';
import { Badge, Demo, dt, Loading, More, PageTitle, Table, usePaged, xof } from '../_components/ui';

interface BookingRow {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  seats: number;
  totalXof: number;
  createdAt: string;
  passengerName: string | null;
  route: string;
  departureAt: string;
  tripRef: string;
  isDemo: boolean;
}

const STATUSES = ['PENDING_ACCEPTANCE', 'PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'EXPIRED', 'REJECTED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN', 'NO_SHOW'];

export function BookingList() {
  const [status, setStatus] = useState('');
  const [ref, setRef] = useState('');
  const [search, setSearch] = useState('');
  const list = usePaged((cursor) => adminCall<Page<BookingRow>>(`bookings${query({ status, q: search, cursor, limit: 30 })}`), [status, search]);
  return (
    <>
      <PageTitle title="Réservations" />
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(ref.trim()); }}>
        <input aria-label="Référence" className="field max-w-xs" placeholder="Référence (ex. IC-…)" value={ref} onChange={(e) => setRef(e.target.value)} />
        <select aria-label="Statut" className="field w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{label(s)}</option>
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
            { label: 'Réf.', render: (r) => <Link href={`/admin/reservations/${r.id}`} className="font-semibold text-brand">{r.reference}<Demo on={r.isDemo} /></Link> },
            { label: 'Trajet', render: (r) => <>{r.route}<span className="block text-xs text-ink-muted">{dt(r.departureAt)}</span></> },
            { label: 'Passager', render: (r) => r.passengerName ?? '—' },
            { label: 'Statut', render: (r) => <Badge code={r.status} /> },
            { label: 'Paiement', render: (r) => <Badge code={r.paymentStatus} /> },
            { label: 'Total', render: (r) => xof(r.totalXof), className: 'text-right tabular-nums' },
          ]}
        />
      )}
      <More next={list.next} onMore={list.more} />
    </>
  );
}
