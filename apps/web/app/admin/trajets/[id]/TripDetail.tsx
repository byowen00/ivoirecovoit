'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, can } from '@/lib/admin';
import { useStaff } from '../../_components/AdminShell';
import { Notes } from '../../_components/Notes';
import { Badge, Demo, dt, Fields, Loading, Notice, PageTitle, ReasonAction, Section, Table, useAdmin, xof } from '../../_components/ui';

interface TripFile {
  id: string;
  publicRef: string;
  status: string;
  kind: string;
  departureAt: string;
  estimatedArrivalAt: string;
  seatsOffered: number;
  acceptanceMode: string;
  cancellationPolicyCode: string;
  routeSource: string | null;
  estimatedDistanceM: number | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  isDemo: boolean;
  driver: { id: string; displayName: string | null };
  vehicle: { make: string; model: string; color: string; plateNumber: string | null };
  stops: { id: string; seq: number; label: string; plannedAt: string; priceFromOriginXof: number }[];
  bookings: { id: string; reference: string; status: string; paymentStatus: string; seats: number; totalXof: number; passengerName: string | null }[];
  actions: { canCancel: boolean };
}

export function TripDetail({ id }: { id: string }) {
  const me = useStaff();
  const { data: t, error, reload } = useAdmin(() => adminCall<TripFile>(`trips/${id}`), [id]);
  const [ok, setOk] = useState<string | null>(null);
  if (!t) return <Loading error={error} />;
  return (
    <>
      <PageTitle title={`Trajet ${t.publicRef}`}>
        <Link href="/admin/trajets" className="text-sm text-brand">← Trajets</Link>
      </PageTitle>
      <Notice ok={ok} />
      <Section
        title="Trajet"
        actions={
          can(me, 'trips.moderate') && t.actions.canCancel ? (
            <ReasonAction
              label="Annuler le trajet"
              danger
              title="Annulation administrative : toutes les réservations sont annulées et les passagers remboursés intégralement"
              run={(reason) => adminCall(`trips/${id}/cancel`, 'POST', { reason })}
              onDone={() => { setOk('Trajet annulé ; les remboursements sont lancés.'); reload(); }}
            />
          ) : undefined
        }
      >
        <Fields
          items={[
            ['Statut', <><Badge code={t.status} /><Demo on={t.isDemo} /></>],
            ['Départ', dt(t.departureAt)],
            ['Arrivée estimée', dt(t.estimatedArrivalAt)],
            ['Conducteur', <Link key="d" href={`/admin/utilisateurs/${t.driver.id}`} className="text-brand">{t.driver.displayName ?? '—'}</Link>],
            ['Véhicule', `${t.vehicle.make} ${t.vehicle.model}, ${t.vehicle.color}${t.vehicle.plateNumber ? ` · ${t.vehicle.plateNumber}` : ''}`],
            ['Places', String(t.seatsOffered)],
            ['Acceptation', t.acceptanceMode === 'AUTO' ? 'Instantanée' : 'Manuelle'],
            ['Annulation', t.cancellationPolicyCode],
            ['Distance', t.estimatedDistanceM ? `${Math.round(t.estimatedDistanceM / 1000)} km (${t.routeSource === 'OSRM' ? 'itinéraire calculé' : 'estimation à vol d’oiseau'})` : '—'],
            ...(t.cancelledAt ? ([['Annulé le', `${dt(t.cancelledAt)} : ${t.cancellationReason ?? ''}`]] as [string, React.ReactNode][]) : []),
          ]}
        />
        <ol className="grid gap-1 text-sm">
          {t.stops.map((s) => (
            <li key={s.id} className="flex justify-between gap-2">
              <span>
                <strong className="tabular-nums">{dt(s.plannedAt)}</strong> {s.label}
              </span>
              <span className="tabular-nums text-ink-muted">{xof(s.priceFromOriginXof)}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-ink-muted">Horaires estimés.</p>
      </Section>
      <Section title="Réservations">
        <Table
          rows={t.bookings}
          rowKey={(b) => b.id}
          empty="Aucune réservation."
          columns={[
            { label: 'Réf.', render: (b) => <Link href={`/admin/reservations/${b.id}`} className="font-semibold text-brand">{b.reference}</Link> },
            { label: 'Passager', render: (b) => b.passengerName ?? '—' },
            { label: 'Places', render: (b) => String(b.seats) },
            { label: 'Statut', render: (b) => <Badge code={b.status} /> },
            { label: 'Paiement', render: (b) => <Badge code={b.paymentStatus} /> },
            { label: 'Total', render: (b) => xof(b.totalXof), className: 'text-right tabular-nums' },
          ]}
        />
      </Section>
      <Notes targetType="TRIP" targetId={id} />
    </>
  );
}
