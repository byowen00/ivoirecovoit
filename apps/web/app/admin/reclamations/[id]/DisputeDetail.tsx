'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, label } from '@/lib/admin';
import { DISPUTE_DECISION_LABEL } from '@/lib/trust';
import { useStaff } from '../../_components/AdminShell';
import { Badge, dt, errText, Fields, Loading, Notice, PageTitle, ReasonAction, Section, useAdmin, xof } from '../../_components/ui';

type Party = 'PASSENGER' | 'DRIVER' | 'STAFF';
interface Dispute {
  id: string;
  reference: string;
  status: string;
  reasonLabel: string;
  description: string;
  openedBy: Party;
  responseDeadline: string | null;
  assignedTo: { id: string; displayName: string | null } | null;
  decision: string | null;
  decisionNote: string | null;
  decidedRefundXof: number | null;
  refundId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  booking: {
    id: string;
    reference: string;
    status: string;
    paymentStatus: string;
    totalXof: number;
    passenger: { id: string; displayName: string | null };
    driver: { id: string; displayName: string | null };
    trip: { id: string; status: string; departureAt: string; startedAt: string | null; completedAt: string | null };
  };
  messages: { id: string; from: Party; author: string | null; body: string; internal: boolean; createdAt: string }[];
  conversation: { id: string; from: Party; body: string; wasRedacted: boolean; hidden: boolean; createdAt: string }[];
  canDecide: boolean;
}

const PARTY: Record<Party, string> = { PASSENGER: 'Passager', DRIVER: 'Conducteur', STAFF: 'Support' };
const DECISIONS = ['NO_REFUND', 'PARTIAL_REFUND', 'FULL_REFUND', 'DRIVER_PENALTY', 'REJECT'] as const;

export function DisputeDetail({ id }: { id: string }) {
  const me = useStaff();
  const { data: d, error, setData } = useAdmin(() => adminCall<Dispute>(`disputes/${id}`), [id]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [decision, setDecision] = useState<(typeof DECISIONS)[number]>('NO_REFUND');
  const [amount, setAmount] = useState('');
  if (!d) return <Loading error={error} />;

  async function patch(input: Record<string, unknown>, ok: string) {
    setMsg({});
    try {
      setData(await adminCall<Dispute>(`disputes/${id}`, 'PATCH', input));
      setMsg({ ok });
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMsg({});
    try {
      setData(await adminCall<Dispute>(`disputes/${id}/messages`, 'POST', { body: body.trim(), internal }));
      setBody('');
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }

  const mine = d.assignedTo?.id === me?.id;
  return (
    <>
      <PageTitle title={`Réclamation ${d.reference}`}>
        <Link href={`/admin/reservations/${d.booking.id}`} className="btn-secondary">Voir la réservation</Link>
      </PageTitle>
      <p className="text-xs text-ink-muted">La consultation de ce dossier, y compris la conversation des parties, est enregistrée dans le journal.</p>
      <Notice ok={msg.ok} error={msg.error} />
      <Section
        title="Dossier"
        actions={
          d.canDecide ? (
            <div className="flex flex-wrap gap-2">
              {mine ? (
                <button type="button" className="btn-secondary" onClick={() => void patch({ unassign: true }, 'Dossier libéré.')}>Libérer</button>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => void patch({ assignToMe: true }, 'Dossier assigné à vous.')}>Prendre le dossier</button>
              )}
              {d.status !== 'IN_REVIEW' && (
                <button type="button" className="btn-secondary" onClick={() => void patch({ status: 'IN_REVIEW' }, 'Passée en examen.')}>Passer en examen</button>
              )}
            </div>
          ) : null
        }
      >
        <Fields
          items={[
            ['Statut', <Badge key="s" code={d.status} />],
            ['Motif', d.reasonLabel],
            ['Ouverte par', `${PARTY[d.openedBy]} le ${dt(d.createdAt)}`],
            ['Réponse attendue avant', dt(d.responseDeadline)],
            ['Assignée à', d.assignedTo?.displayName ?? '—'],
            ['Passager', <Link key="p" href={`/admin/utilisateurs/${d.booking.passenger.id}`} className="text-brand">{d.booking.passenger.displayName ?? '—'}</Link>],
            ['Conducteur', <Link key="c" href={`/admin/utilisateurs/${d.booking.driver.id}`} className="text-brand">{d.booking.driver.displayName ?? '—'}</Link>],
            ['Réservation', <span key="b">{d.booking.reference} · <Badge code={d.booking.status} /> · <Badge code={d.booking.paymentStatus} /> · {xof(d.booking.totalXof)}</span>],
            ['Trajet', <span key="t"><Badge code={d.booking.trip.status} /> départ prévu {dt(d.booking.trip.departureAt)}, démarré {dt(d.booking.trip.startedAt)}, terminé {dt(d.booking.trip.completedAt)}</span>],
          ]}
        />
        <p className="whitespace-pre-wrap rounded bg-surface-muted p-2 text-sm">{d.description}</p>
        {d.resolvedAt && (
          <p className="text-sm">
            Décision du {dt(d.resolvedAt)} : <strong>{d.decision ? (DISPUTE_DECISION_LABEL[d.decision] ?? d.decision) : 'Rejetée'}</strong>
            {d.decidedRefundXof ? ` (${xof(d.decidedRefundXof)})` : ''}. {d.decisionNote}
            {d.refundId && <> <Link href="/admin/finance/remboursements" className="text-brand">Voir les remboursements</Link></>}
          </p>
        )}
      </Section>

      <Section title="Échanges du dossier">
        <ul className="grid gap-2">
          {d.messages.length === 0 && <li className="text-sm text-ink-muted">Aucun message.</li>}
          {d.messages.map((m) => (
            <li key={m.id} className={`rounded p-2 text-sm ${m.internal ? 'border border-dashed border-accent bg-warning-soft' : 'bg-surface-muted'}`}>
              <p className="text-xs text-ink-muted">
                {PARTY[m.from]}{m.author ? ` · ${m.author}` : ''} · {dt(m.createdAt)}{m.internal ? ' · note interne, invisible des parties' : ''}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
        {d.canDecide && (
          <form className="grid gap-2" onSubmit={(e) => void send(e)}>
            <textarea aria-label="Message" rows={3} maxLength={2000} className="field h-auto py-2" value={body} onChange={(e) => setBody(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Note interne (les parties ne la voient pas)
            </label>
            <button type="submit" className="btn-secondary justify-self-start" disabled={body.trim().length < 2}>
              {internal ? 'Ajouter la note' : 'Envoyer aux deux parties'}
            </button>
          </form>
        )}
      </Section>

      <Section title="Conversation entre les parties">
        <ul className="grid gap-1 text-sm">
          {d.conversation.length === 0 && <li className="text-ink-muted">Aucun message échangé.</li>}
          {d.conversation.map((m) => (
            <li key={m.id}>
              <span className="text-xs text-ink-muted">{PARTY[m.from]} · {dt(m.createdAt)}{m.wasRedacted ? ' · coordonnées masquées' : ''}{m.hidden ? ' · masqué par la modération' : ''}</span>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      {d.canDecide && (
        <Section title="Décision">
          <ReasonAction
            label="Rendre la décision"
            title="Décision (motif communiqué aux deux parties)"
            run={(note) =>
              adminCall<Dispute & { refund: { status: string } | null }>(`disputes/${id}/decide`, 'POST', {
                decision,
                note,
                ...(decision === 'PARTIAL_REFUND' ? { refundXof: Number(amount) } : {}),
              })
            }
            onDone={(r) => {
              const res = r as Dispute & { refund: { status: string } | null };
              setData(res);
              setMsg({ ok: res.refund ? `Décision enregistrée. Remboursement : ${label(res.refund.status)}.` : 'Décision enregistrée.' });
            }}
          >
            <label className="grid gap-1 text-sm">
              <span>Décision</span>
              <select className="field" value={decision} onChange={(e) => setDecision(e.target.value as (typeof DECISIONS)[number])}>
                {DECISIONS.map((x) => (
                  <option key={x} value={x}>{x === 'REJECT' ? 'Rejeter la réclamation' : DISPUTE_DECISION_LABEL[x]}</option>
                ))}
              </select>
            </label>
            {decision === 'PARTIAL_REFUND' && (
              <label className="grid gap-1 text-sm">
                <span>Montant à rembourser (F CFA, moins de {xof(d.booking.totalXof)})</span>
                <input type="number" min={1} max={d.booking.totalXof - 1} className="field" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            )}
            {decision === 'FULL_REFUND' && <p className="text-sm">Remboursement de {xof(d.booking.totalXof)}.</p>}
            {decision === 'DRIVER_PENALTY' && <p className="text-sm">La mesure est enregistrée ; une suspension éventuelle se décide sur la fiche du conducteur.</p>}
          </ReasonAction>
          <p className="text-xs text-ink-muted">Un remboursement au-delà de votre plafond reste en attente de validation par une autre personne.</p>
        </Section>
      )}
    </>
  );
}
