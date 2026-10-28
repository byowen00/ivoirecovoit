'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DocumentUpload } from '@/components/DocumentUpload';
import { FieldErrors } from '@/lib/account';
import { ApiRequestError } from '@/lib/api';
import {
  BLOCKER_LABEL,
  driver,
  type DriverDocType,
  type DriverView,
  REQUIREMENT_LABEL,
  uploadDriverDocument,
  uploadVehicleDocument,
  VERIFICATION_LABEL,
  type VehicleView,
} from '@/lib/driver';
import { formatDateTime } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/trips';

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');

const IDENTITY_TYPES: [DriverDocType, string, boolean][] = [
  ['NATIONAL_ID', 'Carte nationale d’identité', true],
  ['PASSPORT', 'Passeport', false],
  ['CONSULAR_CARD', 'Carte consulaire', true],
];

/** Espace conducteur : devenir conducteur (permis, pièces, véhicule), suivi de la vérification. */
export function DriverDashboard() {
  const router = useRouter();
  // undefined = chargement ; null = pas encore de profil conducteur.
  const [profile, setProfile] = useState<DriverView | null | undefined>(undefined);
  const [vehicles, setVehicles] = useState<VehicleView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await driver.me();
      setProfile(p);
      setVehicles((await driver.vehicles()).data);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) router.replace('/connexion?next=/conducteur');
      else if (err instanceof ApiRequestError && err.status === 404) setProfile(null);
      else if (err instanceof ApiRequestError && err.code === 'PROFILE_INCOMPLETE') router.replace('/inscription/profil?next=/conducteur');
      else setError(message(err));
    }
  }, [router]);

  useEffect(() => {
    // Chargement initial depuis l'API (état externe).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) return <p role="alert" className="card text-danger">{error}</p>;
  if (profile === undefined) return <p className="card text-ink-muted">Chargement de votre espace conducteur…</p>;

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div>
        <h1 className="text-2xl font-bold">Espace conducteur</h1>
        {profile && (
          <p className="text-ink-muted">
            Dossier : <strong>{VERIFICATION_LABEL[profile.status]}</strong>
            {profile.submittedAt && profile.status === 'PENDING' && ` (envoyé le ${formatDateTime(profile.submittedAt)})`}
          </p>
        )}
      </div>

      {profile?.canPublish ? (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <p className="font-medium text-success">✓ Vous pouvez publier des trajets.</p>
          <div className="flex gap-2">
            <Link href="/conducteur/publier" className="btn-primary">
              Publier un trajet
            </Link>
            <Link href="/conducteur/trajets" className="btn-secondary">
              Mes trajets
            </Link>
          </div>
        </section>
      ) : (
        profile && (
          <section className="card">
            <p className="font-medium">Avant de publier :</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
              {profile.publishBlockers.map((b) => (
                <li key={b}>{BLOCKER_LABEL[b] ?? b}</li>
              ))}
            </ul>
          </section>
        )
      )}

      <LicenseSection profile={profile} onSaved={setProfile} />
      {profile && <DocumentsSection profile={profile} onChanged={load} />}
      {profile && <VehiclesSection vehicles={vehicles} onChanged={load} />}
      <p className="text-xs text-ink-muted">
        Vos pièces sont stockées de façon privée et ne sont jamais visibles des autres membres. Seule l’équipe de vérification peut les
        consulter, et chaque consultation est enregistrée.
      </p>
    </div>
  );
}

function LicenseSection({ profile, onSaved }: { profile: DriverView | null; onSaved: (p: DriverView) => void }) {
  const [number, setNumber] = useState('');
  const [expires, setExpires] = useState(profile?.license?.expiresOn ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = !profile || profile.canEdit;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFields({});
    setError(null);
    try {
      onSaved(await driver.saveLicense(number, expires));
      setNumber('');
    } catch (err) {
      if (err instanceof FieldErrors && Object.keys(err.fields).length) setFields(err.fields);
      else setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="license" className="card grid gap-3">
      <h2 id="license" className="text-lg font-semibold">
        {profile ? 'Permis de conduire' : 'Devenir conducteur'}
      </h2>
      {!profile && <p className="text-ink-muted">Commencez par votre permis. Vous ajouterez ensuite vos pièces et votre véhicule.</p>}
      {profile?.license && (
        <p className="text-sm">
          Permis n° {profile.license.numberMasked}, valable jusqu’au {profile.license.expiresOn.split('-').reverse().join('/')}
        </p>
      )}
      {editable && (
        <form onSubmit={save} noValidate className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <div>
            <label htmlFor="licenseNumber" className="mb-1 block text-sm font-medium">
              Numéro de permis
            </label>
            <input
              id="licenseNumber"
              className="field"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              autoComplete="off"
              maxLength={25}
              aria-invalid={!!fields.licenseNumber}
            />
            {fields.licenseNumber && <p className="mt-1 text-sm text-danger">{fields.licenseNumber}</p>}
          </div>
          <div>
            <label htmlFor="licenseExpiresOn" className="mb-1 block text-sm font-medium">
              Date d’expiration
            </label>
            <input id="licenseExpiresOn" type="date" className="field" value={expires} onChange={(e) => setExpires(e.target.value)} aria-invalid={!!fields.licenseExpiresOn} />
            {fields.licenseExpiresOn && <p className="mt-1 text-sm text-danger">{fields.licenseExpiresOn}</p>}
          </div>
          <button type="submit" className="btn-primary" disabled={busy || !number || !expires}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}

function DocumentsSection({ profile, onChanged }: { profile: DriverView; onChanged: () => Promise<void> }) {
  const [identity, setIdentity] = useState<DriverDocType>(
    (profile.documents.find((d) => d.docType !== 'DRIVING_LICENSE')?.docType as DriverDocType | undefined) ?? 'NATIONAL_ID',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const doc = (type: DriverDocType, side: 'FRONT' | 'BACK') => profile.documents.find((d) => d.docType === type && d.side === side);
  const upload = (type: DriverDocType, side: 'FRONT' | 'BACK') => async (file: File) => {
    await uploadDriverDocument(file, type, side);
    await onChanged();
  };
  const twoSided = IDENTITY_TYPES.find(([t]) => t === identity)![2];

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await driver.submit();
      await onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="docs" className="card grid gap-3">
      <h2 id="docs" className="text-lg font-semibold">
        Pièces justificatives
      </h2>
      {profile.status === 'REJECTED' && profile.rejectionReason && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm">
          Dossier refusé : {profile.rejectionReason}. Corrigez les pièces concernées puis renvoyez le dossier.
        </p>
      )}
      <ul className="grid gap-1 text-sm">
        {profile.requirements.map((r) => (
          <li key={r.key} className={r.done ? 'text-success' : 'text-ink-muted'}>
            {r.done ? '✓' : '○'} {REQUIREMENT_LABEL[r.key] ?? r.key}
          </li>
        ))}
      </ul>
      <DocumentUpload label="Permis (recto)" current={doc('DRIVING_LICENSE', 'FRONT')} disabled={!profile.canEdit} onUpload={upload('DRIVING_LICENSE', 'FRONT')} />
      <DocumentUpload label="Permis (verso)" current={doc('DRIVING_LICENSE', 'BACK')} disabled={!profile.canEdit} onUpload={upload('DRIVING_LICENSE', 'BACK')} />
      <div>
        <label htmlFor="identity" className="mb-1 block text-sm font-medium">
          Pièce d’identité
        </label>
        <select id="identity" className="field" value={identity} onChange={(e) => setIdentity(e.target.value as DriverDocType)} disabled={!profile.canEdit}>
          {IDENTITY_TYPES.map(([t, label]) => (
            <option key={t} value={t}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <DocumentUpload label={twoSided ? 'Recto' : 'Page d’identité'} current={doc(identity, 'FRONT')} disabled={!profile.canEdit} onUpload={upload(identity, 'FRONT')} />
      {twoSided && <DocumentUpload label="Verso" current={doc(identity, 'BACK')} disabled={!profile.canEdit} onUpload={upload(identity, 'BACK')} />}
      {profile.canEdit && (
        <button type="button" className="btn-primary justify-self-start" disabled={!profile.canSubmit || busy} onClick={() => void submit()}>
          {busy ? 'Envoi…' : 'Envoyer mon dossier pour vérification'}
        </button>
      )}
      {profile.status === 'PENDING' && <p className="text-sm text-ink-muted">Votre dossier est en cours de vérification par notre équipe.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}

function VehiclesSection({ vehicles, onChanged }: { vehicles: VehicleView[]; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(vehicles.length === 0);
  return (
    <section aria-labelledby="vehicles" className="card grid gap-3">
      <h2 id="vehicles" className="text-lg font-semibold">
        Mes véhicules
      </h2>
      {vehicles.map((v) => (
        <VehicleItem key={v.id} vehicle={v} onChanged={onChanged} />
      ))}
      {adding ? (
        <VehicleForm
          onDone={async () => {
            setAdding(false);
            await onChanged();
          }}
          onCancel={vehicles.length ? () => setAdding(false) : undefined}
        />
      ) : (
        <button type="button" className="btn-secondary justify-self-start" onClick={() => setAdding(true)}>
          Ajouter un véhicule
        </button>
      )}
    </section>
  );
}

function VehicleItem({ vehicle: v, onChanged }: { vehicle: VehicleView; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const editable = ['NOT_SUBMITTED', 'REJECTED'].includes(v.status);
  const doc = (t: string) => v.documents.find((d) => d.docType === t);
  const upload = (t: 'VEHICLE_REGISTRATION' | 'INSURANCE' | 'TECHNICAL_INSPECTION' | 'VEHICLE_PHOTO') => async (file: File, exp?: string) => {
    await uploadVehicleDocument(v.id, file, t, exp);
    await onChanged();
  };

  async function submit() {
    setError(null);
    try {
      await driver.submitVehicle(v.id);
      await onChanged();
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <details className="rounded-[var(--radius-control)] border border-line p-3" open={editable}>
      <summary className="cursor-pointer">
        <span className="font-medium">
          {v.make} {v.model} · {v.plateNumber}
        </span>{' '}
        <span className={`text-sm ${v.status === 'APPROVED' ? 'text-success' : v.status === 'REJECTED' ? 'text-danger' : 'text-ink-muted'}`}>
          {VERIFICATION_LABEL[v.status]}
        </span>
      </summary>
      <div className="mt-3 grid gap-2">
        <p className="text-sm text-ink-muted">
          {v.color} · {v.seatsCapacity} place{v.seatsCapacity > 1 ? 's' : ''} passagers{v.year ? ` · ${v.year}` : ''}
        </p>
        {v.status === 'REJECTED' && v.rejectionReason && <p className="text-sm text-danger">Motif du refus : {v.rejectionReason}</p>}
        <DocumentUpload label="Carte grise" current={doc('VEHICLE_REGISTRATION')} disabled={!editable} onUpload={upload('VEHICLE_REGISTRATION')} />
        <DocumentUpload label="Assurance" needsExpiry current={doc('INSURANCE')} disabled={!editable && v.status !== 'APPROVED'} onUpload={upload('INSURANCE')} />
        <DocumentUpload
          label="Visite technique"
          needsExpiry
          current={doc('TECHNICAL_INSPECTION')}
          disabled={!editable && v.status !== 'APPROVED'}
          onUpload={upload('TECHNICAL_INSPECTION')}
        />
        <DocumentUpload label="Photo du véhicule (facultatif)" current={doc('VEHICLE_PHOTO')} disabled={!editable} onUpload={upload('VEHICLE_PHOTO')} />
        {editable && (
          <button type="button" className="btn-primary justify-self-start" disabled={!v.canSubmit} onClick={() => void submit()}>
            Envoyer le véhicule pour vérification
          </button>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </details>
  );
}

function VehicleForm({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel?: () => void }) {
  const [form, setForm] = useState({ make: '', model: '', color: '', year: '', plateNumber: '', seatsCapacity: '3' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Même clé pour les nouvelles tentatives de ce formulaire : pas de véhicule en double.
  const [key] = useState(newIdempotencyKey);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFields({});
    setError(null);
    try {
      await driver.addVehicle(
        {
          make: form.make.trim(),
          model: form.model.trim(),
          color: form.color.trim(),
          year: form.year ? Number(form.year) : null,
          plateNumber: form.plateNumber,
          seatsCapacity: Number(form.seatsCapacity),
        },
        key,
      );
      await onDone();
    } catch (err) {
      if (err instanceof FieldErrors && Object.keys(err.fields).length) setFields(err.fields);
      else setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const input = (id: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`v-${id}`} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input id={`v-${id}`} className="field" value={form[id]} onChange={(e) => setForm({ ...form, [id]: e.target.value })} aria-invalid={!!fields[id]} {...props} />
      {fields[id] && <p className="mt-1 text-sm text-danger">{fields[id]}</p>}
    </div>
  );

  return (
    <form onSubmit={save} noValidate className="grid gap-3 rounded-[var(--radius-control)] border border-line p-3">
      <p className="font-medium">Nouveau véhicule</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {input('make', 'Marque', { placeholder: 'Toyota', maxLength: 40 })}
        {input('model', 'Modèle', { placeholder: 'Corolla', maxLength: 40 })}
        {input('color', 'Couleur', { maxLength: 30 })}
        {input('year', 'Année (facultatif)', { inputMode: 'numeric', maxLength: 4 })}
        {input('plateNumber', 'Immatriculation', { placeholder: '1234 AB 01', maxLength: 15, autoCapitalize: 'characters' })}
        <div>
          <label htmlFor="v-seats" className="mb-1 block text-sm font-medium">
            Places passagers
          </label>
          <select id="v-seats" className="field" value={form.seatsCapacity} onChange={(e) => setForm({ ...form, seatsCapacity: e.target.value })}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {fields.seatsCapacity && <p className="mt-1 text-sm text-danger">{fields.seatsCapacity}</p>}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Ajouter le véhicule'}
        </button>
        {onCancel && (
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}
