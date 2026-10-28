'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, can, query } from '@/lib/admin';
import { useStaff } from './_components/AdminShell';
import { Loading, PageTitle, useAdmin, xof } from './_components/ui';

interface DashboardData {
  users: { total: number; created: number };
  drivers: { verified: number; pending: number };
  trips: { published: number; completed: number; cancelled: number };
  bookings: { created: number; confirmed: number; seats: number };
  money: { paidXof: number; payments: number; commissionXof: number; serviceFeesXof: number; discountsXof: number; refundedXof: number; refunds: number };
  queues: Record<string, number>;
  alerts: { level: 'danger' | 'warning'; code: string; text: string; count: number; link: string }[];
}

const PERIODS = [
  { days: 1, label: '24 h' },
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
];

const QUEUES: { key: string; label: string; href: string }[] = [
  { key: 'driversPending', label: 'Conducteurs à vérifier', href: '/admin/verifications' },
  { key: 'vehiclesPending', label: 'Véhicules à vérifier', href: '/admin/verifications?type=vehicle' },
  { key: 'disputesOpen', label: 'Réclamations ouvertes', href: '/admin/reclamations' },
  { key: 'reportsOpen', label: 'Signalements ouverts', href: '/admin/signalements' },
  { key: 'refundsToApprove', label: 'Remboursements à valider', href: '/admin/finance/remboursements' },
  { key: 'refundsManual', label: 'Remboursements manuels', href: '/admin/finance/remboursements' },
  { key: 'reconciliationOpen', label: 'Écarts de rapprochement', href: '/admin/finance/rapprochement' },
];

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card grid gap-0.5">
      <p className="text-xs uppercase text-ink-muted">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

/** Écran 17 : tableau de bord (indicateurs de la période, files d'attente, alertes). */
export function Dashboard() {
  const me = useStaff();
  const [days, setDays] = useState(7);
  const allowed = can(me, 'stats.read');
  const { data, error } = useAdmin<DashboardData | null>(
    () => (allowed ? adminCall<DashboardData>(`dashboard${query({ from: new Date(Date.now() - days * 86_400_000).toISOString() })}`) : Promise.resolve(null)),
    [days, allowed],
  );

  if (!allowed) {
    return (
      <>
        <PageTitle title="Bienvenue" />
        <p className="card text-sm">Choisissez une rubrique dans le menu. Le tableau de bord est réservé aux rôles qui ont accès aux statistiques.</p>
      </>
    );
  }
  return (
    <>
      <PageTitle title="Tableau de bord">
        <div role="group" aria-label="Période" className="flex gap-1">
          {PERIODS.map((p) => (
            <button key={p.days} type="button" aria-pressed={days === p.days} className={days === p.days ? 'btn-primary' : 'btn-secondary'} onClick={() => setDays(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
      </PageTitle>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          {data.alerts.length > 0 && (
            <ul className="grid gap-2" aria-label="Alertes">
              {data.alerts.map((a) => (
                <li key={a.code}>
                  <Link href={a.link} className={`card flex justify-between gap-2 border-l-4 ${a.level === 'danger' ? 'border-l-danger' : 'border-l-accent'}`}>
                    <span>{a.text}</span>
                    <strong className="tabular-nums">{a.count}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Paiements reçus" value={xof(data.money.paidXof)} sub={`${data.money.payments} paiement(s)`} />
            <Kpi label="Commissions" value={xof(data.money.commissionXof)} sub={`Frais de service ${xof(data.money.serviceFeesXof)}`} />
            <Kpi label="Remboursé" value={xof(data.money.refundedXof)} sub={`${data.money.refunds} remboursement(s)`} />
            <Kpi label="Réductions promo" value={xof(data.money.discountsXof)} />
            <Kpi label="Réservations" value={data.bookings.created} sub={`${data.bookings.confirmed} confirmées, ${data.bookings.seats} places`} />
            <Kpi label="Trajets publiés" value={data.trips.published} sub={`${data.trips.completed} terminés, ${data.trips.cancelled} annulés`} />
            <Kpi label="Utilisateurs" value={data.users.total} sub={`${data.users.created} nouveaux sur la période`} />
            <Kpi label="Conducteurs vérifiés" value={data.drivers.verified} sub={`${data.drivers.pending} en attente`} />
          </div>
          <section className="card grid gap-2" aria-label="Files d’attente">
            <h2 className="text-lg font-semibold">À traiter</h2>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {QUEUES.map((q) => (
                <li key={q.key}>
                  <Link href={q.href} className="flex justify-between gap-2 rounded px-2 py-1 hover:bg-surface-muted">
                    <span>{q.label}</span>
                    <strong className="tabular-nums">{data.queues[q.key] ?? 0}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <p className="text-xs text-ink-muted">Montants issus des paiements confirmés par le prestataire ; en environnement de développement, il s’agit du bac à sable.</p>
        </>
      )}
    </>
  );
}
