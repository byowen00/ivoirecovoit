'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, can, label, query } from '@/lib/admin';
import { useStaff } from '../../_components/AdminShell';
import { Badge, dt, errText, Loading, More, Notice, PageTitle, ReasonAction, Table, usePaged, xof } from '../../_components/ui';

interface RefundRow {
  id: string;
  status: string;
  amountXof: number;
  reasonCode: string;
  note: string | null;
  createdAt: string;
  bookingId: string;
  bookingReference: string;
  requestedBy: string | null;
  requestedByName: string | null;
}
interface RefundPage {
  data: RefundRow[];
  nextCursor: string | null;
  limits: { supportCapXof: number; doubleValidationAboveXof: number };
}

const STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'MANUAL_REQUIRED', 'REJECTED'];
const REASON: Record<string, string> = {
  ADMIN: 'Décision du support', DISPUTE: 'Réclamation', DRIVER_CANCELLED: 'Annulé par le conducteur', PASSENGER_CANCELLED: 'Annulé par le passager',
  TRIP_CHANGED: 'Trajet modifié', LATE_PAYMENT: 'Paiement arrivé trop tard', TRIP_NOT_STARTED: 'Trajet non commencé', DRIVER_LATE: 'Retard du conducteur',
};

export function RefundList() {
  const me = useStaff();
  const [status, setStatus] = useState('REQUESTED');
  const [limits, setLimits] = useState<RefundPage['limits'] | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const list = usePaged(async (cursor) => {
    const r = await adminCall<RefundPage>(`refunds${query({ status, cursor, limit: 30 })}`);
    setLimits(r.limits);
    return r;
  }, [status]);
  const approver = can(me, 'refunds.approve');

  async function approve(id: string) {
    setMsg({});
    try {
      await adminCall(`refunds/${id}/approve`, 'POST', {});
      setMsg({ ok: 'Remboursement validé : il part chez le prestataire de paiement.' });
      list.reload();
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }

  return (
    <>
      <PageTitle title="Remboursements" />
      {limits && (
        <p className="text-sm text-ink-muted">
          Plafond d’un agent de support : {xof(limits.supportCapXof)}. Au-delà de {xof(limits.doubleValidationAboveXof)}, une deuxième personne doit valider.
          Ces seuils se règlent dans les paramètres (valeurs de démonstration à confirmer).
        </p>
      )}
      <Notice ok={msg.ok} error={msg.error} />
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
          empty="Aucun remboursement."
          columns={[
            { label: 'Demandé', render: (r) => <>{dt(r.createdAt)}<span className="block text-xs text-ink-muted">{r.requestedByName ?? 'Automatique'}</span></> },
            { label: 'Réservation', render: (r) => <Link href={`/admin/reservations/${r.bookingId}`} className="text-brand">{r.bookingReference}</Link> },
            { label: 'Motif', render: (r) => <>{REASON[r.reasonCode] ?? r.reasonCode}{r.note && <span className="block text-xs text-ink-muted">{r.note}</span>}</> },
            { label: 'Statut', render: (r) => <Badge code={r.status} /> },
            { label: 'Montant', render: (r) => xof(r.amountXof), className: 'text-right tabular-nums' },
            {
              label: 'Actions',
              render: (r) =>
                r.status === 'REQUESTED' && approver ? (
                  r.requestedBy === me?.id ? (
                    <span className="text-xs text-ink-muted">Validation par une autre personne</span>
                  ) : (
                    <div className="grid gap-2">
                      <button type="button" className="btn-primary" onClick={() => void approve(r.id)}>Valider</button>
                      <ReasonAction label="Refuser" danger run={(reason) => adminCall(`refunds/${r.id}/reject`, 'POST', { reason })} onDone={() => { setMsg({ ok: 'Demande refusée.' }); list.reload(); }} />
                    </div>
                  )
                ) : null,
            },
          ]}
        />
      )}
      <More next={list.next} onMore={list.more} />
    </>
  );
}
