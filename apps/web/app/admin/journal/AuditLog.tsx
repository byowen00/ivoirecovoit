'use client';

import { useState } from 'react';
import { adminCall, query, ROLE_LABEL } from '@/lib/admin';
import { dt, Loading, More, PageTitle, Table, usePaged } from '../_components/ui';

interface AuditRow {
  id: number | string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  changes: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AuditLog() {
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [actor, setActor] = useState('');
  const [filters, setFilters] = useState({ action: '', targetId: '', actorId: '' });
  const list = usePaged(
    (cursor) =>
      adminCall<{ data: AuditRow[]; nextCursor: string | null }>(
        `audit-logs${query({ action: filters.action, targetId: filters.targetId, actorId: filters.actorId, before: cursor, limit: 50 })}`,
      ),
    [filters],
  );
  const invalid = (v: string) => v.trim() !== '' && !UUID.test(v.trim());
  return (
    <>
      <PageTitle title="Journal d’audit" />
      <p className="text-sm text-ink-muted">
        Actions sensibles du personnel et du système, y compris les accès refusés (« access.denied »). Le journal ne peut être ni modifié ni effacé depuis la console.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid(target) && !invalid(actor)) setFilters({ action: action.trim(), targetId: target.trim(), actorId: actor.trim() });
        }}
      >
        <input aria-label="Action" className="field max-w-[12rem]" placeholder="Action (ex. refund.approved)" value={action} onChange={(e) => setAction(e.target.value)} />
        <input aria-label="Cible" className="field max-w-xs" placeholder="Identifiant de la cible" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={invalid(target)} />
        <input aria-label="Auteur" className="field max-w-xs" placeholder="Identifiant de l’auteur" value={actor} onChange={(e) => setActor(e.target.value)} aria-invalid={invalid(actor)} />
        <button type="submit" className="btn-secondary">Filtrer</button>
      </form>
      {!list.rows ? (
        <Loading error={list.error} />
      ) : (
        <Table
          rows={list.rows}
          rowKey={(r) => String(r.id)}
          empty="Aucune entrée."
          columns={[
            { label: 'Date', render: (r) => dt(r.createdAt) },
            { label: 'Action', render: (r) => <code className={`text-xs ${r.action === 'access.denied' ? 'text-danger' : ''}`}>{r.action}</code> },
            { label: 'Auteur', render: (r) => <>{r.actorRole ? (ROLE_LABEL[r.actorRole] ?? r.actorRole) : 'Système'}{r.actorId && <code className="block break-all text-xs text-ink-muted">{r.actorId}</code>}</> },
            { label: 'Cible', render: (r) => (r.targetType ? <>{r.targetType}<code className="block break-all text-xs text-ink-muted">{r.targetId}</code></> : '—') },
            { label: 'Motif', render: (r) => r.reason ?? '—' },
            { label: 'Détails', render: (r) => (r.changes ? <code className="break-all text-xs">{JSON.stringify(r.changes)}</code> : '—') },
          ]}
        />
      )}
      <More next={list.next} onMore={list.more} />
    </>
  );
}
