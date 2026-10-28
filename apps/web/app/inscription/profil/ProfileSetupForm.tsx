'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { account, FieldErrors, type Me } from '@/lib/account';
import { ApiRequestError } from '@/lib/api';
import { safeNext } from '@/lib/pending-otp';

/** Après le premier code : prénom, nom et acceptation des textes. Le compte devient alors actif. */
export function ProfileSetupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    account.me().then(
      (data) => {
        if (cancelled) return;
        if (data.profileComplete) {
          router.replace(safeNext(params.get('next')));
          return;
        }
        setMe(data);
        setFirstName(data.firstName ?? '');
        setLastName(data.lastName ?? '');
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 401) router.replace('/connexion');
        else setLoadError(err instanceof ApiRequestError ? err.message : 'Chargement impossible.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [router, params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    const local: Record<string, string> = {};
    if (!firstName.trim()) local.firstName = 'Indiquez votre prénom.';
    if (!lastName.trim()) local.lastName = 'Indiquez votre nom.';
    if (!accepted) local.accept = 'Vous devez accepter les conditions pour utiliser le service.';
    setFields(local);
    if (Object.keys(local).length) return;

    setSaving(true);
    setError(null);
    try {
      await account.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      let latest = me;
      for (const c of me.requiredConsents.filter((x) => !x.accepted)) {
        latest = await account.consent(c.type, c.version, true);
      }
      if (!latest.profileComplete) throw new Error('incomplet');
      router.replace(safeNext(params.get('next')));
      router.refresh();
    } catch (err) {
      if (err instanceof FieldErrors && Object.keys(err.fields).length) setFields(err.fields);
      else setError(err instanceof ApiRequestError ? err.message : 'Enregistrement impossible. Réessayez.');
      setSaving(false);
    }
  }

  if (loadError) return <p role="alert" className="card text-danger">{loadError}</p>;
  if (!me) return <p className="card text-ink-muted">Chargement…</p>;

  return (
    <form onSubmit={submit} noValidate className="card grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Faisons connaissance</h1>
        <p className="mt-1 text-ink-muted">Seuls votre prénom et l’initiale de votre nom seront visibles des autres membres.</p>
      </div>
      {(
        [
          ['firstName', 'Prénom', firstName, setFirstName, 'given-name'],
          ['lastName', 'Nom', lastName, setLastName, 'family-name'],
        ] as const
      ).map(([id, label, value, set, ac]) => (
        <div key={id}>
          <label htmlFor={id} className="mb-1 block text-sm font-medium">
            {label}
          </label>
          <input
            id={id}
            value={value}
            onChange={(e) => set(e.target.value)}
            autoComplete={ac}
            maxLength={60}
            aria-invalid={!!fields[id]}
            aria-describedby={fields[id] ? `${id}-error` : undefined}
            className="field"
          />
          {fields[id] && (
            <p id={`${id}-error`} className="mt-1 text-sm text-danger">
              {fields[id]}
            </p>
          )}
        </div>
      ))}
      <div>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
            aria-describedby={fields.accept ? 'accept-error' : undefined}
          />
          <span className="text-sm">
            J’accepte les{' '}
            <Link href="/conditions" target="_blank" className="underline">
              conditions générales d’utilisation
            </Link>{' '}
            et la{' '}
            <Link href="/confidentialite" target="_blank" className="underline">
              politique de confidentialité
            </Link>{' '}
            (version {me.requiredConsents[0]?.version}).
          </span>
        </label>
        {fields.accept && (
          <p id="accept-error" className="mt-1 text-sm text-danger">
            {fields.accept}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={saving}>
        {saving ? 'Enregistrement…' : 'Continuer'}
      </button>
    </form>
  );
}
