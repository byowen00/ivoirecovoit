'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, label, type Page, query } from '@/lib/admin';
import { REPORT_CATEGORY_LABEL, type ReportCategory } from '@/lib/trust';
import { Badge, dt, Loading, More, PageTitle, Table, usePaged } from '../_components/ui';

interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  category: ReportCategory;
  severity: string;
  status: string;
  createdAt: string;
  reporterName: string | null;
  assignedTo: { id: string; displayName: string | null } | null;
}

export const TARGET_LABEL: Record<string, string> = { USER: 'Utilisateur', TRIP: 'Trajet', MESSAGE: 'Message', REVIEW: 'Avis', VEHICLE: 'Véhicule' };
const STATUSES = ['OPEN', 'IN_REVIEW', 'ACTION_TAKEN', 'DISMISSED'];
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function ReportList() {
  const [filter, setFilter] = useState('open');
  const [severity, setSeverity] = useState('');
  const status = STATUSES.includes(filter) ? filter : undefined;
  const list = usePaged(
    (cursor) => adminCall<Page<ReportRow>>(`reports${query({ status, open: filter === 'open' ? true : undefined, severity, cursor, limit: 30 })}`),
    [filter, severity],
  );
  return (
    <>
      <PageTitle title="Signalements" />
      <p className="text-sm text-ink-muted">Classés du plus grave au moins grave, puis du plus ancien au plus récent.</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Statut" className="field w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">À traiter</option>
          <option value="">Tous</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{label(s)}</option>
          ))}
        </select>
        <select aria-label="Gravité" className="field w-auto" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">Toutes gravités</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{label(s)}</option>
          ))}
        </select>
      </div>
      {!list.rows ? (
        <Loading error={list.error} />
      ) : (
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          empty="Aucun signalement."
          columns={[
            { label: 'Reçu', render: (r) => <Link href={`/admin/signalements/${r.id}`} className="font-semibold text-brand">{dt(r.createdAt)}</Link> },
            { label: 'Gravité', render: (r) => <Badge code={r.severity} /> },
            { label: 'Catégorie', render: (r) => REPORT_CATEGORY_LABEL[r.category] ?? r.category },
            { label: 'Cible', render: (r) => TARGET_LABEL[r.targetType] ?? r.targetType },
            { label: 'Par', render: (r) => r.reporterName ?? '—' },
            { label: 'Statut', render: (r) => <><Badge code={r.status} />{r.assignedTo && <span className="block text-xs text-ink-muted">{r.assignedTo.displayName}</span>}</> },
          ]}
        />
      )}
      <More next={list.next} onMore={list.more} />
    </>
  );
}
