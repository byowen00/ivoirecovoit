'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, type Page, query } from '@/lib/admin';
import { Badge, Demo, dt, Loading, More, PageTitle, Table, usePaged } from '../_components/ui';

interface UserRow {
  id: string;
  displayName: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
  status: string;
  suspendedUntil: string | null;
  isStaff: boolean;
  isDemo: boolean;
  createdAt: string;
}

export function UserList() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const list = usePaged((cursor) => adminCall<Page<UserRow>>(`users${query({ q: search, status, cursor, limit: 30 })}`), [search, status]);

  return (
    <>
      <PageTitle title="Utilisateurs" />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <input aria-label="Rechercher" className="field max-w-xs" placeholder="Nom, téléphone ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Statut" className="field w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'BANNED', 'DELETED'].map((s) => (
            <option key={s} value={s}>
              {s === 'ACTIVE' ? 'Actifs' : s === 'PENDING_VERIFICATION' ? 'À vérifier' : s === 'SUSPENDED' ? 'Suspendus' : s === 'BANNED' ? 'Bannis' : 'Supprimés'}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-secondary">
          Rechercher
        </button>
      </form>
      <p className="text-xs text-ink-muted">Téléphones et e-mails masqués : l’affichage en clair se demande depuis la fiche, avec un motif journalisé.</p>
      {!list.rows ? (
        <Loading error={list.error} />
      ) : (
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          columns={[
            {
              label: 'Nom',
              render: (r) => (
                <Link href={`/admin/utilisateurs/${r.id}`} className="font-semibold text-brand">
                  {r.displayName ?? '(sans nom)'}
                  {r.isStaff && ' · personnel'}
                  <Demo on={r.isDemo} />
                </Link>
              ),
            },
            { label: 'Téléphone', render: (r) => r.phoneMasked ?? '—', className: 'tabular-nums' },
            { label: 'Statut', render: (r) => <Badge code={r.status} /> },
            { label: 'Inscrit le', render: (r) => dt(r.createdAt) },
          ]}
        />
      )}
      <More next={list.next} onMore={list.more} />
    </>
  );
}
