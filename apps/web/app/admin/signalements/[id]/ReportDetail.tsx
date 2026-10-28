'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall } from '@/lib/admin';
import { REPORT_CATEGORY_LABEL, type ReportCategory } from '@/lib/trust';
import { Badge, dt, errText, Fields, Loading, Notice, PageTitle, ReasonAction, Section, useAdmin } from '../../_components/ui';
import { TARGET_LABEL } from '../ReportList';

interface Report {
  id: string;
  targetType: 'USER' | 'TRIP' | 'MESSAGE' | 'REVIEW' | 'VEHICLE';
  targetId: string;
  target: Record<string, unknown>;
  bookingId: string | null;
  category: ReportCategory;
  severity: string;
  description: string;
  status: string;
  resolution: string | null;
  assignedTo: string | null;
  reporter: { id: string; displayName: string | null };
  createdAt: string;
  updatedAt: string;
}

const str = (v: unknown) => (v === null || v === undefined ? '—' : String(v));

export function ReportDetail({ id }: { id: string }) {
  const { data: r, error, setData, reload } = useAdmin(() => adminCall<Report>(`reports/${id}`), [id]);
  const [resolution, setResolution] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  if (!r) return <Loading error={error} />;
  const text = resolution ?? r.resolution ?? '';

  async function update(input: Record<string, unknown>, ok: string) {
    setMsg({});
    try {
      setData(await adminCall<Report>(`reports/${id}`, 'PATCH', input));
      setMsg({ ok });
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }

  const t = r.target;
  const closed = r.status === 'ACTION_TAKEN' || r.status === 'DISMISSED';
  return (
    <>
      <PageTitle title="Signalement" />
      <Notice ok={msg.ok} error={msg.error} />
      <Section
        title={REPORT_CATEGORY_LABEL[r.category] ?? r.category}
        actions={
          !closed ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => void update({ assignToMe: true, status: 'IN_REVIEW' }, 'Pris en charge.')}>
                Prendre en charge
              </button>
            </div>
          ) : null
        }
      >
        <Fields
          items={[
            ['Statut', <Badge key="s" code={r.status} />],
            ['Gravité', <Badge key="g" code={r.severity} />],
            ['Reçu', dt(r.createdAt)],
            ['Signalé par', <Link key="r" href={`/admin/utilisateurs/${r.reporter.id}`} className="text-brand">{r.reporter.displayName ?? '—'}</Link>],
            ['Réservation', r.bookingId ? <Link key="b" href={`/admin/reservations/${r.bookingId}`} className="text-brand">Ouvrir</Link> : '—'],
          ]}
        />
        <p className="whitespace-pre-wrap rounded bg-surface-muted p-2 text-sm">{r.description}</p>
      </Section>

      <Section title={`Cible : ${TARGET_LABEL[r.targetType] ?? r.targetType}`}>
        {r.targetType === 'USER' && (
          <p className="text-sm">
            <Link href={`/admin/utilisateurs/${r.targetId}`} className="font-semibold text-brand">{str(t.displayName)}</Link> · <Badge code={str(t.status)} />
            <span className="block text-xs text-ink-muted">Suspension ou bannissement depuis la fiche du compte.</span>
          </p>
        )}
        {r.targetType === 'TRIP' && (
          <p className="text-sm">
            <Link href={`/admin/trajets/${r.targetId}`} className="font-semibold text-brand">{str(t.publicRef)}</Link> · <Badge code={str(t.status)} />
          </p>
        )}
        {r.targetType === 'MESSAGE' && (
          <>
            <p className="whitespace-pre-wrap rounded bg-surface-muted p-2 text-sm">{str(t.body)}</p>
            <p className="text-xs text-ink-muted">Envoyé le {dt(t.createdAt as string)}{t.hidden ? ' · déjà masqué' : ''}</p>
            {!t.hidden && (
              <ReasonAction label="Masquer ce message" danger run={(reason) => adminCall(`messages/${r.targetId}/hide`, 'POST', { reason })} onDone={() => { setMsg({ ok: 'Message masqué.' }); reload(); }} />
            )}
          </>
        )}
        {r.targetType === 'REVIEW' && (
          <>
            <p className="text-sm">{str(t.rating)}/5 : « {str(t.comment)} »{t.hidden ? ' (masqué)' : ''}</p>
            <ReasonAction
              label={t.hidden ? 'Republier l’avis' : 'Masquer l’avis'}
              danger={!t.hidden}
              run={(reason) => adminCall(`reviews/${r.targetId}/visibility`, 'POST', { hidden: !t.hidden, reason })}
              onDone={() => { setMsg({ ok: t.hidden ? 'Avis republié.' : 'Avis masqué : la note moyenne est recalculée.' }); reload(); }}
            />
          </>
        )}
        {r.targetType === 'VEHICLE' && <p className="text-sm text-ink-muted">Véhicule : vérifier depuis la file des vérifications.</p>}
      </Section>

      <Section title="Suite donnée">
        <label className="grid gap-1 text-sm">
          <span>Ce qui a été décidé (visible du support uniquement)</span>
          <textarea rows={3} maxLength={1000} className="field h-auto py-2" value={text} onChange={(e) => setResolution(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={text.trim().length < 2} onClick={() => void update({ status: 'ACTION_TAKEN', resolution: text.trim() }, 'Signalement traité.')}>
            Mesure prise
          </button>
          <button type="button" className="btn-secondary" disabled={text.trim().length < 2} onClick={() => void update({ status: 'DISMISSED', resolution: text.trim() }, 'Signalement classé.')}>
            Classer sans suite
          </button>
          {closed && (
            <button type="button" className="btn-secondary" onClick={() => void update({ status: 'IN_REVIEW' }, 'Signalement rouvert.')}>Rouvrir</button>
          )}
        </div>
      </Section>
    </>
  );
}
