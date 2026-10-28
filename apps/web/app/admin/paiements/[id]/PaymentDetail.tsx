'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, can } from '@/lib/admin';
import { useStaff } from '../../_components/AdminShell';
import { Badge, dt, errText, Fields, Loading, Notice, PageTitle, Section, Table, useAdmin, xof } from '../../_components/ui';
import type { PaymentRow } from '../PaymentList';

interface PaymentEvent {
  source: string;
  type: string;
  reportedStatus: string | null;
  amountXof: number | null;
  signatureValid: boolean | null;
  occurredAt: string | null;
  receivedAt: string;
  result: string | null;
}

interface Payment extends PaymentRow {
  providerReference: string | null;
  failureMessage: string | null;
  expiresAt: string | null;
  lastPolledAt: string | null;
  events: PaymentEvent[];
}

const RESULT: Record<string, string> = {
  APPLIED: 'statut vérifié appliqué',
  DUPLICATE: 'aucun changement',
  IGNORED_STALE: 'réponse plus ancienne que le statut actuel, ignorée',
  REJECTED: 'réponse rejetée',
  MISMATCH: 'montant ou référence différents, à examiner',
};

export function PaymentDetail({ id }: { id: string }) {
  const me = useStaff();
  const { data: p, error, setData } = useAdmin(() => adminCall<Payment>(`payments/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  if (!p) return <Loading error={error} />;

  async function recheck() {
    setBusy(true);
    setMsg({});
    try {
      const r = await adminCall<{ result: string | null; payment: Payment }>(`payments/${id}/recheck`, 'POST', {});
      setData(r.payment);
      setMsg({ ok: `Vérification auprès du prestataire : ${r.result ? (RESULT[r.result] ?? r.result) : 'pas de réponse exploitable (autre prestataire ou paiement clos)'}.` });
    } catch (err) {
      setMsg({ error: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  const open = ['CREATED', 'PENDING', 'PROCESSING'].includes(p.status);
  return (
    <>
      <PageTitle title={`Paiement ${p.bookingReference}`}>
        <Link href={`/admin/reservations/${p.bookingId}`} className="btn-secondary">Voir la réservation</Link>
      </PageTitle>
      <Notice ok={msg.ok} error={msg.error} />
      <Section
        title="Détails"
        actions={
          open && can(me, 'payments.read') ? (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void recheck()}>
              Revérifier auprès du prestataire
            </button>
          ) : null
        }
      >
        <Fields
          items={[
            ['Statut', <Badge key="s" code={p.status} />],
            ['Montant', xof(p.amountXof)],
            ['Moyen', `${p.method} (${p.provider})`],
            ['Payeur', p.payerPhoneMasked ?? '—'],
            ['Réf. prestataire', p.providerReference ?? '—'],
            ['Créé', dt(p.createdAt)],
            ['Expire', dt(p.expiresAt)],
            ['Réussi', dt(p.succeededAt)],
            ['Dernière interrogation', dt(p.lastPolledAt)],
            ['Échec', p.failureCode ? `${p.failureCode}${p.failureMessage ? ` : ${p.failureMessage}` : ''}` : '—'],
          ]}
        />
      </Section>
      <Section title="Événements reçus">
        <Table
          rows={p.events}
          rowKey={(e) => `${e.receivedAt}-${e.type}-${e.source}`}
          empty="Aucun événement du prestataire."
          columns={[
            { label: 'Reçu', render: (e) => dt(e.receivedAt) },
            { label: 'Source', render: (e) => `${e.source} · ${e.type}` },
            { label: 'Statut annoncé', render: (e) => e.reportedStatus ?? '—' },
            { label: 'Montant', render: (e) => xof(e.amountXof), className: 'text-right tabular-nums' },
            { label: 'Signature', render: (e) => (e.signatureValid === null ? '—' : e.signatureValid ? 'Valide' : <span className="text-danger">Invalide</span>) },
            { label: 'Résultat', render: (e) => (e.result ? (RESULT[e.result] ?? e.result) : '—') },
          ]}
        />
      </Section>
    </>
  );
}
