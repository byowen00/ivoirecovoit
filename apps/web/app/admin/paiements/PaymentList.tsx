'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, label, type Page, query } from '@/lib/admin';
import { Badge, dt, Loading, More, PageTitle, Table, usePaged, xof } from '../_components/ui';

export interface PaymentRow {
  id: string;
  status: string;
  method: string;
  amountXof: number;
  provider: string;
  payerPhoneMasked: string | null;
  createdAt: string;
  succeededAt: string | null;
  failureCode: string | null;
  bookingId: string;
  bookingReference: string;
}

const STATUSES = ['CREATED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'];

export function PaymentList() {
  const [status, setStatus] = useState('');
  const list = usePaged((cursor) => adminCall<Page<PaymentRow>>(`payments${query({ status, cursor, limit: 30 })}`), [status]);
  return (
    <>
      <PageTitle title="Paiements" />
      <p className="text-sm text-ink-muted">
        Un paiement n’est « Réussi » qu’après confirmation vérifiée du prestataire (webhook signé ou interrogation directe). La console ne peut pas le forcer.
      </p>
      <select aria-label="Statut" className="field w-auto justify-self-start" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Tous les statuts</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>{label(s)}</option>
        ))}
      </select>
      {!list.rows ? (
        <Loading error={list.error} />
      ) : (
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          columns={[
            { label: 'Créé', render: (r) => <Link href={`/admin/paiements/${r.id}`} className="font-semibold text-brand">{dt(r.createdAt)}</Link> },
            { label: 'Réservation', render: (r) => <Link href={`/admin/reservations/${r.bookingId}`} className="text-brand">{r.bookingReference}</Link> },
            { label: 'Moyen', render: (r) => <>{r.method}<span className="block text-xs text-ink-muted">{r.provider}{r.payerPhoneMasked ? ` · ${r.payerPhoneMasked}` : ''}</span></> },
            { label: 'Statut', render: (r) => <><Badge code={r.status} />{r.failureCode && <span className="block text-xs text-ink-muted">{r.failureCode}</span>}</> },
            { label: 'Montant', render: (r) => xof(r.amountXof), className: 'text-right tabular-nums' },
          ]}
        />
      )}
      <More next={list.next} onMore={list.more} />
    </>
  );
}
