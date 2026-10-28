'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, can, type Page } from '@/lib/admin';
import { useStaff } from '../../_components/AdminShell';
import { Notes } from '../../_components/Notes';
import { Badge, Demo, dt, Fields, Loading, Notice, PageTitle, ReasonAction, Section, Table, useAdmin, xof } from '../../_components/ui';

interface UserFile {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phoneMasked: string | null;
  phoneVerified: boolean;
  emailMasked: string | null;
  status: string;
  suspendedUntil: string | null;
  driverVerificationStatus: string | null;
  isStaff: boolean;
  isDemo: boolean;
  activeSessions: number;
  createdAt: string;
}
interface BookingRow {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  totalXof: number;
  route: string;
  departureAt: string;
}

export function UserDetail({ id }: { id: string }) {
  const me = useStaff();
  const { data: u, error, reload } = useAdmin(() => adminCall<UserFile>(`users/${id}`), [id]);
  const bookings = useAdmin(() => adminCall<Page<BookingRow>>(`bookings?userId=${id}&limit=20`), [id]);
  const [revealed, setRevealed] = useState<{ phone?: string | null; email?: string | null } | null>(null);
  const [until, setUntil] = useState('');
  const [ok, setOk] = useState<string | null>(null);

  if (!u) return <Loading error={error} />;
  const fullModeration = can(me, 'users.moderate');
  const shortModeration = can(me, 'users.moderate', 'users.moderate.short');
  const done = (text: string) => () => {
    setOk(text);
    reload();
  };

  return (
    <>
      <PageTitle title={`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Utilisateur'}>
        <Link href="/admin/utilisateurs" className="text-sm text-brand">
          ← Utilisateurs
        </Link>
      </PageTitle>
      <Notice ok={ok} />
      <Section title="Fiche">
        <Fields
          items={[
            ['Statut', <><Badge code={u.status} />{u.suspendedUntil && ` jusqu’au ${dt(u.suspendedUntil)}`}<Demo on={u.isDemo} /></>],
            ['Téléphone', <span key="p" className="tabular-nums">{revealed?.phone ?? u.phoneMasked ?? '—'}{u.phoneVerified ? ' (vérifié)' : ''}</span>],
            ['E-mail', revealed?.email ?? u.emailMasked ?? '—'],
            ['Conducteur', u.driverVerificationStatus ? <Badge code={u.driverVerificationStatus} /> : 'Non'],
            ['Sessions actives', String(u.activeSessions)],
            ['Inscrit le', dt(u.createdAt)],
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {can(me, 'users.read_sensitive') && !revealed && (
            <ReasonAction
              label="Afficher téléphone et e-mail"
              title="Affichage de données personnelles"
              minLength={10}
              placeholder="Ex. : rappel du passager au sujet de la réclamation R-…"
              run={(reason) => adminCall<{ phone?: string; email?: string }>(`users/${id}/reveal`, 'POST', { reason, fields: ['phone', 'email'] })}
              onDone={(r) => setRevealed(r as { phone?: string; email?: string })}
            />
          )}
          {shortModeration && u.status === 'ACTIVE' && !u.isStaff && (
            <ReasonAction
              label="Suspendre"
              danger
              title={fullModeration ? 'Suspension' : 'Suspension (72 h au plus pour votre rôle)'}
              minLength={10}
              run={(reason) => adminCall(`users/${id}/suspend`, 'POST', { reason, ...(until ? { until: new Date(until).toISOString() } : {}) })}
              onDone={done('Compte suspendu : ses sessions sont fermées.')}
            >
              <label className="grid gap-1 text-sm">
                Fin de la suspension {fullModeration ? '(vide = jusqu’à nouvel ordre)' : '(obligatoire)'}
                <input type="datetime-local" className="field" value={until} onChange={(e) => setUntil(e.target.value)} />
              </label>
            </ReasonAction>
          )}
          {shortModeration && u.status === 'SUSPENDED' && (
            <ReasonAction label="Lever la suspension" minLength={10} run={(reason) => adminCall(`users/${id}/unsuspend`, 'POST', { reason })} onDone={done('Suspension levée.')} />
          )}
          {fullModeration && !u.isStaff && u.status !== 'BANNED' && u.status !== 'DELETED' && (
            <ReasonAction
              label="Bannir"
              danger
              title="Bannissement définitif : trajets à venir annulés et passagers remboursés"
              run={(reason) => adminCall(`users/${id}/ban`, 'POST', { reason })}
              onDone={done('Compte banni.')}
            />
          )}
        </div>
      </Section>
      <Section title="Réservations récentes (passager ou conducteur)">
        {!bookings.data ? (
          <Loading error={bookings.error} />
        ) : (
          <Table
            rows={bookings.data.data}
            rowKey={(r) => r.id}
            columns={[
              { label: 'Réf.', render: (r) => <Link href={`/admin/reservations/${r.id}`} className="font-semibold text-brand">{r.reference}</Link> },
              { label: 'Trajet', render: (r) => r.route },
              { label: 'Départ', render: (r) => dt(r.departureAt) },
              { label: 'Statut', render: (r) => <Badge code={r.status} /> },
              { label: 'Total', render: (r) => xof(r.totalXof), className: 'text-right tabular-nums' },
            ]}
          />
        )}
      </Section>
      {can(me, 'users.read') && <Notes targetType="USER" targetId={id} />}
    </>
  );
}
