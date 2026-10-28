'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, adminRefund, can, label } from '@/lib/admin';
import { useStaff } from '../../_components/AdminShell';
import { Notes } from '../../_components/Notes';
import { Badge, Demo, dt, Fields, Loading, Notice, PageTitle, ReasonAction, Section, Table, useAdmin, xof } from '../../_components/ui';

interface BookingFile {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  seats: number;
  route: string;
  trip: { id: string; publicRef: string; status: string; departureAt: string };
  passenger: { id: string; displayName: string | null; phoneMasked: string | null };
  driver: { id: string; displayName: string | null };
  amounts: { unitPriceXof: number; subtotalXof: number; serviceFeeXof: number; discountXof: number; totalXof: number; commissionXof: number; driverNetXof: number; refundDueXof: number | null; refundedXof: number };
  cancellation: { at: string | null; reason: string | null; refundReason: string | null };
  createdAt: string;
  isDemo: boolean;
  history: { from: string | null; to: string; reason: string | null; at: string; actorId: string | null }[];
  payments: { id: string; status: string; method: string; amountXof: number; provider: string; payerPhoneMasked: string | null; createdAt: string; succeededAt: string | null; failureCode: string | null }[];
  refunds: { id: string; status: string; amountXof: number; reasonCode: string; note: string | null; createdAt: string; succeededAt: string | null }[];
  disputes: { id: string; reference: string; status: string; reasonCode: string; createdAt: string }[];
  commission: { status: string; driverNetXof: number; adjustedXof: number; commissionXof: number; payableAt: string | null } | null;
  actions: { canCancel: boolean; canRefund: boolean; maxRefundXof: number };
}

export function BookingDetail({ id }: { id: string }) {
  const me = useStaff();
  const { data: b, error, reload } = useAdmin(() => adminCall<BookingFile>(`bookings/${id}`), [id]);
  const [amount, setAmount] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  if (!b) return <Loading error={error} />;
  const a = b.amounts;
  const canRefund = can(me, 'refunds.create', 'refunds.create.capped') && b.actions.canRefund;

  return (
    <>
      <PageTitle title={`Réservation ${b.reference}`}>
        <Link href="/admin/reservations" className="text-sm text-brand">← Réservations</Link>
      </PageTitle>
      <Notice ok={ok} />
      <Section
        title="Réservation"
        actions={
          can(me, 'trips.moderate') && b.actions.canCancel ? (
            <ReasonAction
              label="Annuler la réservation"
              danger
              title="Annulation administrative : le passager est remboursé intégralement"
              run={(reason) => adminCall(`bookings/${id}/cancel`, 'POST', { reason })}
              onDone={() => { setOk('Réservation annulée.'); reload(); }}
            />
          ) : undefined
        }
      >
        <Fields
          items={[
            ['Statut', <><Badge code={b.status} /> <Badge code={b.paymentStatus} /><Demo on={b.isDemo} /></>],
            ['Trajet', <Link key="t" href={`/admin/trajets/${b.trip.id}`} className="text-brand">{b.route} · {b.trip.publicRef} · {dt(b.trip.departureAt)}</Link>],
            ['Passager', <Link key="p" href={`/admin/utilisateurs/${b.passenger.id}`} className="text-brand">{b.passenger.displayName ?? '—'} ({b.passenger.phoneMasked ?? '—'})</Link>],
            ['Conducteur', <Link key="d" href={`/admin/utilisateurs/${b.driver.id}`} className="text-brand">{b.driver.displayName ?? '—'}</Link>],
            ['Places', String(b.seats)],
            ['Prix', `${xof(a.unitPriceXof)} × ${b.seats} = ${xof(a.subtotalXof)}`],
            ['Frais de service', xof(a.serviceFeeXof)],
            ...(a.discountXof ? ([['Réduction promo', `−${xof(a.discountXof)}`]] as [string, React.ReactNode][]) : []),
            ['Total payé par le passager', <strong key="tot">{xof(a.totalXof)}</strong>],
            ['Commission / net conducteur', `${xof(a.commissionXof)} / ${xof(a.driverNetXof)}`],
            ['Remboursé', xof(a.refundedXof)],
            ...(b.cancellation.at ? ([['Annulation', `${dt(b.cancellation.at)} : ${b.cancellation.reason ?? ''}`]] as [string, React.ReactNode][]) : []),
            ...(b.commission ? ([['Gains du conducteur', <>{label(b.commission.status)}{b.commission.payableAt ? ` (disponibles le ${dt(b.commission.payableAt)})` : ''}</>]] as [string, React.ReactNode][]) : []),
          ]}
        />
      </Section>

      <Section title="Paiements">
        <Table
          rows={b.payments}
          rowKey={(p) => p.id}
          empty="Aucun paiement."
          columns={[
            { label: 'Date', render: (p) => <Link href={`/admin/paiements/${p.id}`} className="text-brand">{dt(p.createdAt)}</Link> },
            { label: 'Moyen', render: (p) => `${p.method} · ${p.provider}` },
            { label: 'Payeur', render: (p) => p.payerPhoneMasked ?? '—', className: 'tabular-nums' },
            { label: 'Statut', render: (p) => <>{<Badge code={p.status} />}{p.failureCode && <span className="block text-xs text-ink-muted">{p.failureCode}</span>}</> },
            { label: 'Montant', render: (p) => xof(p.amountXof), className: 'text-right tabular-nums' },
          ]}
        />
      </Section>

      <Section title="Remboursements">
        <Table
          rows={b.refunds}
          rowKey={(r) => r.id}
          empty="Aucun remboursement."
          columns={[
            { label: 'Date', render: (r) => dt(r.createdAt) },
            { label: 'Motif', render: (r) => <>{r.reasonCode}{r.note && <span className="block text-xs text-ink-muted">{r.note}</span>}</> },
            { label: 'Statut', render: (r) => <Badge code={r.status} /> },
            { label: 'Montant', render: (r) => xof(r.amountXof), className: 'text-right tabular-nums' },
          ]}
        />
        {canRefund && (
          <ReasonAction
            label="Rembourser"
            title={`Remboursement (au plus ${xof(b.actions.maxRefundXof)})`}
            run={async (note) => {
              const r = await adminRefund({ bookingId: id, amountXof: Number(amount), reasonCode: 'ADMIN', note });
              setOk(r.status === 'REQUESTED' ? 'Remboursement enregistré : il attend la validation d’une autre personne.' : 'Remboursement validé et envoyé au prestataire.');
              setAmount('');
              reload();
            }}
          >
            <label className="grid gap-1 text-sm">
              Montant en F CFA
              <input type="number" min={1} max={b.actions.maxRefundXof} required className="field" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <p className="text-xs text-ink-muted">
              Les frais de service ne sont rendus qu’au-delà de la part trajet. Au-delà de votre plafond ou du seuil de double validation, une autre personne devra valider.
            </p>
          </ReasonAction>
        )}
      </Section>

      {b.disputes.length > 0 && (
        <Section title="Réclamations">
          <ul className="grid gap-1 text-sm">
            {b.disputes.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/reclamations/${d.id}`} className="text-brand">{d.reference}</Link> · {d.reasonCode} · <Badge code={d.status} /> · {dt(d.createdAt)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Historique">
        <ol className="grid gap-1 text-sm">
          {b.history.map((h, i) => (
            <li key={i}>
              <span className="tabular-nums text-ink-muted">{dt(h.at)}</span> · {label(h.from)} → {label(h.to)}
              {h.actorId === null ? ' (automatique)' : ''}
              {h.reason ? ` : ${h.reason}` : ''}
            </li>
          ))}
        </ol>
      </Section>
      <Notes targetType="BOOKING" targetId={id} />
    </>
  );
}
