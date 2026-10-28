'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, label, type Page, query } from '@/lib/admin';
import { useStaff } from '../_components/AdminShell';
import { Badge, dt, Loading, More, PageTitle, Table, usePaged, xof } from '../_components/ui';

interface DisputeRow {
  id: string;
  reference: string;
  status: string;
  reasonCode: string;
  reasonLabel: string;
  createdAt: string;
  responseDeadline: string | null;
  assignedTo: { id: string; displayName: string | null } | null;
  bookingReference: string;
  totalXof: number;
}

const STATUSES = ['OPEN', 'AWAITING_RESPONSE', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED'];

export function DisputeList() {
  const me = useStaff();
  const [filter, setFilter] = useState('open');
  const [mine, setMine] = useState(false);
  const status = STATUSES.includes(filter) ? filter : undefined;
  const list = usePaged(
    (cursor) => adminCall<Page<DisputeRow>>(`disputes${query({ status, open: filter === 'open' ? true : undefined, assignedTo: mine ? me?.id : undefined, cursor, limit: 30 })}`),
    [filter, mine, me?.id],
  );
  return (
    <>
      <PageTitle title="Réclamations" />
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Statut" className="field w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">À traiter</option>
          <option value="">Toutes</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{label(s)}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assignées à moi
        </label>
      </div>
      {!list.rows ? (
        <Loading error={list.error} />
      ) : (
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          empty="Aucune réclamation."
          columns={[
            { label: 'Réf.', render: (r) => <Link href={`/admin/reclamations/${r.id}`} className="font-semibold text-brand">{r.reference}</Link> },
            { label: 'Ouverte', render: (r) => dt(r.createdAt) },
            { label: 'Motif', render: (r) => r.reasonLabel },
            { label: 'Réservation', render: (r) => <>{r.bookingReference}<span className="block text-xs text-ink-muted">{xof(r.totalXof)}</span></> },
            { label: 'Statut', render: (r) => <><Badge code={r.status} />{r.responseDeadline && r.status === 'AWAITING_RESPONSE' && <span className="block text-xs text-ink-muted">réponse avant {dt(r.responseDeadline)}</span>}</> },
            { label: 'Assignée', render: (r) => r.assignedTo?.displayName ?? '—' },
          ]}
        />
      )}
      <More next={list.next} onMore={list.more} />
    </>
  );
}
