'use client';

import { useState } from 'react';
import { adminCall, can } from '@/lib/admin';
import { useStaff } from '../_components/AdminShell';
import { Badge, Demo, dt, errText, Fields, Loading, PageTitle, ReasonAction, Section, Table, useAdmin } from '../_components/ui';

type Kind = 'driver' | 'vehicle' | 'document';
interface Item {
  type: Kind;
  id: string;
  displayName?: string | null;
  label?: string;
  plateNumber?: string | null;
  docType?: string;
  status?: string;
  submittedAt?: string | null;
  uploadedAt?: string;
  isDemo?: boolean;
  driver?: { id: string; displayName: string | null };
  owner?: { type: string; id: string };
}
interface Doc {
  id: string;
  docType: string;
  side: string | null;
  status: string;
  mimeType: string;
  sizeBytes: number;
  expiresOn: string | null;
  rejectionReason: string | null;
  uploadedAt: string | null;
}
interface Detail {
  id: string;
  displayName?: string | null;
  status: string;
  submittedAt: string | null;
  rejectionReason: string | null;
  documents: Doc[];
  level?: number;
  licenseExpiresOn?: string | null;
  vehicles?: { id: string; label: string; status: string }[];
  make?: string;
  model?: string;
  color?: string;
  year?: number | null;
  plateNumber?: string | null;
  seatsCapacity?: number;
}

const DOC_LABEL: Record<string, string> = {
  NATIONAL_ID: 'Pièce d’identité', PASSPORT: 'Passeport', CONSULAR_CARD: 'Carte consulaire', DRIVING_LICENSE: 'Permis de conduire', SELFIE: 'Photo de vérification',
  VEHICLE_REGISTRATION: 'Carte grise', INSURANCE: 'Assurance', TECHNICAL_INSPECTION: 'Visite technique', VEHICLE_PHOTO: 'Photo du véhicule',
};
const TABS: { type: Kind; label: string }[] = [
  { type: 'driver', label: 'Conducteurs' },
  { type: 'vehicle', label: 'Véhicules' },
  { type: 'document', label: 'Pièces renouvelées' },
];

/** File de vérification (conducteurs, véhicules, pièces) ; les pièces ne s'ouvrent qu'avec un motif journalisé. */
export function Verifications({ initialType }: { initialType: Kind }) {
  const [type, setType] = useState<Kind>(initialType);
  const [status, setStatus] = useState('PENDING');
  const [selected, setSelected] = useState<Item | null>(null);
  const list = useAdmin(() => adminCall<{ data: Item[] }>(`verifications?type=${type}&status=${status}&limit=50`), [type, status]);

  return (
    <>
      <PageTitle title="Vérifications">
        <select aria-label="Statut" className="field w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING">À vérifier</option>
          <option value="APPROVED">Validés</option>
          <option value="REJECTED">Refusés</option>
        </select>
      </PageTitle>
      <div role="tablist" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.type} role="tab" aria-selected={type === t.type} type="button" className={type === t.type ? 'btn-primary' : 'btn-secondary'} onClick={() => { setType(t.type); setSelected(null); }}>
            {t.label}
          </button>
        ))}
      </div>
      {!list.data ? (
        <Loading error={list.error} />
      ) : (
        <Table
          rows={list.data.data}
          rowKey={(r) => r.id}
          empty="Rien à vérifier."
          columns={[
            {
              label: 'Élément',
              render: (r) => (
                <>
                  {r.type === 'driver' && r.displayName}
                  {r.type === 'vehicle' && `${r.label}${r.plateNumber ? ` · ${r.plateNumber}` : ''}`}
                  {r.type === 'document' && `${DOC_LABEL[r.docType ?? ''] ?? r.docType} (${r.owner?.type === 'vehicle' ? 'véhicule' : 'conducteur'})`}
                  <Demo on={r.isDemo} />
                </>
              ),
            },
            { label: 'Conducteur', render: (r) => r.driver?.displayName ?? (r.type === 'driver' ? '' : '—') },
            { label: 'Déposé', render: (r) => dt(r.submittedAt ?? r.uploadedAt) },
            { label: 'Statut', render: (r) => <Badge code={r.status ?? status} /> },
            {
              label: '',
              render: (r) =>
                r.type !== 'document' ? (
                  <button type="button" className="font-semibold text-brand" onClick={() => setSelected(r)}>
                    Examiner
                  </button>
                ) : (
                  <button type="button" className="font-semibold text-brand" onClick={() => setSelected({ ...r, type: r.owner?.type === 'vehicle' ? 'vehicle' : 'driver', id: r.owner!.id })}>
                    Voir le dossier
                  </button>
                ),
            },
          ]}
        />
      )}
      {selected && <VerificationDetail item={selected} onDone={() => { setSelected(null); list.reload(); }} />}
    </>
  );
}

function VerificationDetail({ item, onDone }: { item: Item; onDone: () => void }) {
  const me = useStaff();
  const kind = item.type === 'vehicle' ? 'vehicle' : 'driver';
  const { data, error, reload } = useAdmin(() => adminCall<Detail>(`verifications/${kind}/${item.id}`), [kind, item.id]);
  const [note, setNote] = useState('');
  const [rejectIds, setRejectIds] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  if (!data) return <Loading error={error} />;
  const decide = can(me, 'verifications.decide') && data.status === 'PENDING';

  async function approve() {
    setMsg({});
    try {
      await adminCall(`verifications/${kind}/${item.id}/approve`, 'POST', note.trim() ? { note: note.trim() } : {});
      onDone();
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }

  return (
    <Section title={kind === 'driver' ? `Dossier de ${data.displayName ?? 'conducteur'}` : `Véhicule ${data.make} ${data.model}`}>
      <Fields
        items={[
          ['Statut', <Badge key="s" code={data.status} />],
          ['Soumis le', dt(data.submittedAt)],
          ...(kind === 'driver'
            ? ([
                ['Niveau', String(data.level ?? '—')],
                ['Permis valable jusqu’au', data.licenseExpiresOn ?? '—'],
                ['Véhicules', data.vehicles?.map((v) => `${v.label} (${v.status})`).join(', ') || '—'],
              ] as [string, React.ReactNode][])
            : ([
                ['Véhicule', `${data.make} ${data.model}, ${data.color}${data.year ? `, ${data.year}` : ''}`],
                ['Immatriculation', data.plateNumber ?? '—'],
                ['Places', String(data.seatsCapacity ?? '—')],
              ] as [string, React.ReactNode][])),
          ...(data.rejectionReason ? ([['Dernier refus', data.rejectionReason]] as [string, React.ReactNode][]) : []),
        ]}
      />
      <h3 className="font-semibold">Pièces</h3>
      <ul className="grid gap-2">
        {data.documents.map((d) => (
          <li key={d.id} className="grid gap-1 rounded border border-line p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {DOC_LABEL[d.docType] ?? d.docType}
                {d.side ? ` (${d.side === 'FRONT' ? 'recto' : 'verso'})` : ''} · <Badge code={d.status} />
                {d.expiresOn && <span className="text-ink-muted"> · expire le {d.expiresOn}</span>}
              </span>
              {decide && (
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={rejectIds.includes(d.id)} onChange={(e) => setRejectIds((ids) => (e.target.checked ? [...ids, d.id] : ids.filter((x) => x !== d.id)))} />
                  À refaire
                </label>
              )}
            </div>
            {can(me, 'documents.view') ? (
              <ReasonAction
                label="Afficher la pièce"
                title="Consultation d’une pièce justificative"
                minLength={10}
                placeholder="Ex. : vérification du dossier en attente"
                run={async (reason) => {
                  const r = await adminCall<{ url: string }>(`documents/${d.id}/download-url`, 'POST', { reason });
                  window.open(r.url, '_blank', 'noopener,noreferrer');
                }}
              />
            ) : (
              <p className="text-xs text-ink-muted">Votre rôle ne permet pas d’ouvrir les pièces.</p>
            )}
          </li>
        ))}
      </ul>
      {msg.error && <p role="alert" className="text-sm text-danger">{msg.error}</p>}
      {decide && (
        <div className="grid gap-2 border-t border-line pt-3">
          <label className="grid gap-1 text-sm">
            Note interne (facultative)
            <input className="field" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => void approve()}>
              Valider le dossier
            </button>
            <ReasonAction
              label="Refuser"
              danger
              title="Refus : le motif est montré au conducteur"
              run={(reason) => adminCall(`verifications/${kind}/${item.id}/reject`, 'POST', { reason, documentIds: rejectIds })}
              onDone={() => {
                reload();
                onDone();
              }}
            />
          </div>
        </div>
      )}
    </Section>
  );
}
