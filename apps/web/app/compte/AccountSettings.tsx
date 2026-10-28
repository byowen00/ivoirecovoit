'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { OtpInput } from '@/components/OtpInput';
import { account, FieldErrors, formatLocalPhone, type Me, type OtpRequest, type Preferences, type SessionInfo } from '@/lib/account';
import { ApiRequestError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { notifications, type NotificationPreferences } from '@/lib/trust';
import { checkFile, fileMeta, MAX_PHOTO_BYTES, PHOTO_TYPES, putSigned } from '@/lib/upload';

// Version des textes d'information pour les consentements facultatifs.
const OPTIONAL_CONSENT_VERSION = '1';

const LANGUAGES: [string, string][] = [
  ['fr', 'Français'],
  ['en', 'Anglais'],
  ['dioula', 'Dioula'],
  ['baoule', 'Baoulé'],
  ['bete', 'Bété'],
  ['senoufo', 'Sénoufo'],
  ['agni', 'Agni'],
  ['autre', 'Autre'],
];

function displayPhone(e164: string | null): string {
  return e164 ? `+225 ${formatLocalPhone(e164.replace(/^\+225/, ''))}` : '';
}

function message(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `section-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="card grid gap-4">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Status({ ok, error }: { ok?: string | null; error?: string | null }) {
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (ok) return <p role="status" className="text-sm text-success">{ok}</p>;
  return null;
}

/** Écran 15 : données, préférences, consentements, contact d'urgence, appareils, suppression. */
export function AccountSettings() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    account.me().then(
      (data) => {
        if (cancelled) return;
        if (!data.profileComplete) router.replace('/inscription/profil?next=/compte');
        else setMe(data);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 401) router.replace('/connexion?next=/compte');
        else setLoadError(message(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loadError) return <p role="alert" className="card text-danger">{loadError}</p>;
  if (!me) return <p className="card text-ink-muted">Chargement de votre compte…</p>;

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div>
        <h1 className="text-2xl font-bold">Mon compte</h1>
        <p className="text-ink-muted">
          {me.displayName} · {displayPhone(me.phone)} {me.isDemo && <span className="ml-1 rounded bg-warning-soft px-1 text-xs">[DEMO]</span>}
        </p>
      </div>
      <PhotoSection me={me} onSaved={setMe} />
      <ProfileSection me={me} onSaved={setMe} />
      <PreferencesSection me={me} onSaved={setMe} />
      <NotificationsSection />
      <ConsentsSection me={me} onSaved={setMe} />
      <EmergencySection />
      <SessionsSection />
      <DeleteSection />
    </div>
  );
}

/** Écran 13 (réglages) : catégories de notifications ; celles liées aux réservations et paiements restent actives. */
function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  useEffect(() => {
    notifications.preferences().then(setPrefs, (err: unknown) => setStatus({ error: message(err) }));
  }, []);

  async function toggle(code: string, enabled: boolean) {
    setStatus({});
    try {
      setPrefs(await notifications.setPreferences({ [code]: enabled }));
      setStatus({ ok: 'Préférences enregistrées.' });
    } catch (err) {
      setStatus({ error: message(err) });
    }
  }

  return (
    <div id="notifications">
      <Section title="Notifications">
        {prefs && (
          <>
            <ul className="grid gap-2">
              {prefs.categories.map((c) => (
                <li key={c.code}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={c.enabled} disabled={c.mandatory} onChange={(e) => void toggle(c.code, e.target.checked)} />
                    <span>
                      {c.label}
                      {c.mandatory && <span className="block text-xs text-ink-muted">Toujours envoyées : elles concernent vos réservations et votre argent.</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-muted">
              {prefs.pushAvailable
                ? 'Les notifications arrivent dans l’application et sur votre téléphone.'
                : 'Les notifications sont visibles dans l’application (cloche en haut de page). L’envoi sur le téléphone n’est pas encore activé.'}
            </p>
          </>
        )}
        <Status ok={status.ok} error={status.error} />
      </Section>
    </div>
  );
}

function PhotoSection({ me, onSaved }: { me: Me; onSaved: (me: Me) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    const problem = checkFile(file, PHOTO_TYPES, MAX_PHOTO_BYTES);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const { meta, body } = await fileMeta(file);
      const { upload } = await account.photoUploadUrl(meta);
      await putSigned(upload, body);
      onSaved(await account.photoComplete());
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await account.photoDelete());
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Photo de profil">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={me.displayName ?? '?'} url={me.photoUrl} size="h-20 w-20 text-2xl" />
        <div className="grid gap-2">
          <label className="btn-secondary cursor-pointer">
            {busy ? 'Envoi…' : me.photoUrl ? 'Changer de photo' : 'Ajouter une photo'}
            <input
              type="file"
              accept={PHOTO_TYPES.join(',')}
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f);
              }}
            />
          </label>
          {me.photoUrl && (
            <button type="button" className="text-sm text-danger underline" onClick={() => void remove()} disabled={busy}>
              Retirer la photo
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-ink-muted">Visible des autres membres sur votre profil. JPEG, PNG ou WebP, 5 Mo maximum.</p>
      <Status error={error} />
    </Section>
  );
}

function ProfileSection({ me, onSaved }: { me: Me; onSaved: (me: Me) => void }) {
  const [form, setForm] = useState({
    firstName: me.firstName ?? '',
    lastName: me.lastName ?? '',
    email: me.email ?? '',
    bio: me.bio ?? '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFields({});
    setStatus({});
    try {
      onSaved(
        await account.update({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim() || null,
          bio: form.bio.trim() || null,
        }),
      );
      setStatus({ ok: 'Informations enregistrées.' });
    } catch (err) {
      if (err instanceof FieldErrors && Object.keys(err.fields).length) setFields(err.fields);
      else setStatus({ error: message(err) });
    } finally {
      setSaving(false);
    }
  }

  const input = (id: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        value={form[id]}
        onChange={(e) => setForm({ ...form, [id]: e.target.value })}
        aria-invalid={!!fields[id]}
        aria-describedby={fields[id] ? `${id}-error` : undefined}
        className="field"
        {...props}
      />
      {fields[id] && (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {fields[id]}
        </p>
      )}
    </div>
  );

  return (
    <Section title="Mes informations">
      <form onSubmit={save} noValidate className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {input('firstName', 'Prénom', { autoComplete: 'given-name', maxLength: 60 })}
          {input('lastName', 'Nom', { autoComplete: 'family-name', maxLength: 60 })}
        </div>
        {input('email', 'E-mail (facultatif)', { type: 'email', autoComplete: 'email', maxLength: 254 })}
        <div>
          <label htmlFor="bio" className="mb-1 block text-sm font-medium">
            Quelques mots sur vous (facultatif)
          </label>
          <textarea
            id="bio"
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            maxLength={300}
            rows={3}
            className="field h-auto py-2"
          />
          <p className="text-right text-xs text-ink-muted">{form.bio.length}/300</p>
        </div>
        <p className="text-sm text-ink-muted">Numéro de téléphone : {displayPhone(me.phone)} (vérifié). Le changement de numéro arrivera plus tard.</p>
        <Status ok={status.ok} error={status.error} />
        <button type="submit" className="btn-primary justify-self-start" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </Section>
  );
}

function PreferencesSection({ me, onSaved }: { me: Me; onSaved: (me: Me) => void }) {
  const [prefs, setPrefs] = useState<Preferences>(me.preferences);
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [saving, setSaving] = useState(false);
  const toggles: [keyof Preferences, string][] = [
    ['music', 'J’aime la musique pendant le trajet'],
    ['pets', 'J’accepte les animaux'],
    ['smoking', 'Je fume (pauses cigarette)'],
  ];

  async function save() {
    setSaving(true);
    setStatus({});
    try {
      onSaved(await account.update({ preferences: prefs }));
      setStatus({ ok: 'Préférences enregistrées.' });
    } catch (err) {
      setStatus({ error: message(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Préférences de voyage">
      {toggles.map(([key, label]) => (
        <label key={key} className="flex items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={!!prefs[key]}
            onChange={(e) => setPrefs({ ...prefs, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <div>
        <label htmlFor="chat" className="mb-1 block text-sm font-medium">
          Discussion
        </label>
        <select
          id="chat"
          className="field"
          value={prefs.chat ?? ''}
          onChange={(e) => setPrefs({ ...prefs, chat: (e.target.value || undefined) as Preferences['chat'] })}
        >
          <option value="">Non précisé</option>
          <option value="QUIET">Plutôt calme</option>
          <option value="SOME">Selon l’humeur</option>
          <option value="CHATTY">J’aime discuter</option>
        </select>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Langues parlées</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {LANGUAGES.map(([code, label]) => (
            <label key={code} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={prefs.languages?.includes(code) ?? false}
                onChange={(e) => {
                  const set = new Set(prefs.languages ?? []);
                  if (e.target.checked) set.add(code);
                  else set.delete(code);
                  setPrefs({ ...prefs, languages: [...set] });
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <Status ok={status.ok} error={status.error} />
      <button type="button" className="btn-primary justify-self-start" onClick={() => void save()} disabled={saving}>
        {saving ? 'Enregistrement…' : 'Enregistrer mes préférences'}
      </button>
    </Section>
  );
}

function ConsentsSection({ me, onSaved }: { me: Me; onSaved: (me: Me) => void }) {
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  // Affichage immédiat du choix, annulé si l'enregistrement échoue.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const granted = (type: string) => pending[type] ?? me.consents.find((c) => c.type === type)?.granted ?? false;
  const optional: ['MARKETING' | 'LOCATION_LIVE', string, string][] = [
    ['MARKETING', 'Recevoir les offres et actualités', 'SMS ou notifications promotionnelles. Les messages liés à vos trajets restent envoyés.'],
    [
      'LOCATION_LIVE',
      'Partager ma position pendant un trajet en cours',
      'Uniquement pendant un trajet commencé, jamais publique. Fonction prévue dans une version ultérieure.',
    ],
  ];

  async function toggle(type: 'MARKETING' | 'LOCATION_LIVE', value: boolean) {
    setStatus({});
    setPending((p) => ({ ...p, [type]: value }));
    try {
      onSaved(await account.consent(type, OPTIONAL_CONSENT_VERSION, value));
      setStatus({ ok: 'Choix enregistré.' });
    } catch (err) {
      setStatus({ error: message(err) });
    } finally {
      setPending(({ [type]: _done, ...rest }) => rest);
    }
  }

  return (
    <Section title="Consentements">
      <ul className="grid gap-1 text-sm text-ink-muted">
        {me.requiredConsents.map((c) => {
          const at = me.consents.find((x) => x.type === c.type)?.at;
          return (
            <li key={c.type}>
              {c.type === 'TERMS' ? 'Conditions d’utilisation' : 'Politique de confidentialité'} : acceptées
              {at ? ` le ${formatDateTime(at)}` : ''} (version {c.version}).
            </li>
          );
        })}
      </ul>
      {optional.map(([type, label, help]) => (
        <label key={type} className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0"
            checked={granted(type)}
            onChange={(e) => void toggle(type, e.target.checked)}
          />
          <span>
            {label}
            <span className="block text-sm text-ink-muted">{help}</span>
          </span>
        </label>
      ))}
      <Status ok={status.ok} error={status.error} />
    </Section>
  );
}

function EmergencySection() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});

  useEffect(() => {
    account.emergencyContact().then(
      (res) => {
        if (res.data) {
          setName(res.data.name);
          setPhone(res.data.phone);
        }
      },
      () => undefined,
    );
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFields({});
    setStatus({});
    try {
      const res = await account.setEmergencyContact(name.trim(), phone.trim());
      setPhone(res.data.phone);
      setStatus({ ok: 'Contact d’urgence enregistré.' });
    } catch (err) {
      if (err instanceof FieldErrors && Object.keys(err.fields).length) setFields(err.fields);
      else setStatus({ error: message(err) });
    }
  }

  return (
    <Section title="Contact d’urgence">
      <p className="text-sm text-ink-muted">Privé : jamais montré aux autres membres. Utile pour la fonction de partage de trajet.</p>
      <form onSubmit={save} noValidate className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ec-name" className="mb-1 block text-sm font-medium">
            Nom
          </label>
          <input id="ec-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={!!fields.name} />
          {fields.name && <p className="mt-1 text-sm text-danger">{fields.name}</p>}
        </div>
        <div>
          <label htmlFor="ec-phone" className="mb-1 block text-sm font-medium">
            Téléphone
          </label>
          <input id="ec-phone" type="tel" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={25} aria-invalid={!!fields.phone} />
          {fields.phone && <p className="mt-1 text-sm text-danger">{fields.phone}</p>}
        </div>
        <div className="sm:col-span-2 grid gap-2">
          <Status ok={status.ok} error={status.error} />
          <button type="submit" className="btn-secondary justify-self-start">
            Enregistrer le contact
          </button>
        </div>
      </form>
    </Section>
  );
}

function SessionsSection() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    account.sessions().then(
      (res) => setSessions(res.data),
      (err: unknown) => setError(message(err)),
    );
  }, []);
  useEffect(load, [load]);

  async function revoke(id: string) {
    try {
      await account.revokeSession(id);
      load();
    } catch (err) {
      setError(message(err));
    }
  }

  async function signOut(all: boolean) {
    try {
      if (all) await account.revokeAll();
      else await account.logout();
    } catch {
      // La session est fermée côté navigateur dans tous les cas.
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <Section title="Appareils connectés">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!sessions ? (
        <p className="text-sm text-ink-muted">Chargement…</p>
      ) : (
        <ul className="divide-y divide-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="font-medium">
                  {s.deviceLabel ?? 'Appareil'} {s.current && <span className="text-sm text-success">(cet appareil)</span>}
                </p>
                <p className="text-sm text-ink-muted">Dernière activité : {s.lastUsedAt ? formatDateTime(s.lastUsedAt) : '—'}</p>
              </div>
              {!s.current && (
                <button type="button" className="btn-secondary" onClick={() => void revoke(s.id)}>
                  Déconnecter
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => void signOut(false)}>
          Me déconnecter
        </button>
        <button type="button" className="btn-secondary" onClick={() => void signOut(true)}>
          Déconnecter tous mes appareils
        </button>
      </div>
    </Section>
  );
}

function DeleteSection() {
  const router = useRouter();
  const [otp, setOtp] = useState<OtpRequest | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setOtp(await account.deletionOtp());
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!otp) return;
    setBusy(true);
    setError(null);
    try {
      await account.deleteAccount(otp.otpRequestId, code);
      router.replace('/?compte=supprime');
      router.refresh();
    } catch (err) {
      setError(message(err));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <Section title="Supprimer mon compte">
      <p className="text-sm text-ink-muted">
        Vos données d’identité sont effacées et toutes vos sessions fermées. Les traces des paiements sont conservées de
        façon anonyme, comme la loi l’exige. Impossible tant qu’une réservation ou un trajet est en cours.
      </p>
      {!otp ? (
        <button type="button" className="btn-danger justify-self-start" onClick={() => void start()} disabled={busy}>
          Supprimer mon compte
        </button>
      ) : (
        <div className="grid gap-3">
          <p className="text-sm">Saisissez le code envoyé par SMS pour confirmer la suppression définitive.</p>
          {otp.testCode && (
            <p role="note" className="rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-sm">
              Mode test : code <strong>{otp.testCode}</strong>
            </p>
          )}
          <OtpInput value={code} onChange={setCode} disabled={busy} invalid={!!error} />
          <div className="flex gap-2">
            <button type="button" className="btn-danger" disabled={busy || code.length !== 6} onClick={() => void confirm()}>
              Confirmer la suppression
            </button>
            <button type="button" className="btn-secondary" onClick={() => setOtp(null)} disabled={busy}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </Section>
  );
}
