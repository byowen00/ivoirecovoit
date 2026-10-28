'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { auth, FieldErrors, formatLocalPhone, localMobileDigits } from '@/lib/account';
import { ApiRequestError } from '@/lib/api';
import { safeNext, savePendingOtp } from '@/lib/pending-otp';

/** Écran 2 : inscription et connexion ne font qu'un. Un seul champ, indicatif +225 fixe. */
export function PhoneForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const digits = localMobileDigits(phone);
    if (!digits) {
      setError('Saisissez un numéro de mobile à 10 chiffres commençant par 01, 05 ou 07.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const otp = await auth.requestOtp(`+225${digits}`);
      savePendingOtp({ ...otp, phone: digits, sentAt: Date.now(), next: safeNext(params.get('next')) });
      router.push('/connexion/code');
    } catch (err) {
      if (err instanceof FieldErrors && err.fields.phone) setError(err.fields.phone);
      else setError(err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="card grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Connexion ou inscription</h1>
        <p className="mt-1 text-ink-muted">Nous vous envoyons un code par SMS pour vérifier votre numéro.</p>
      </div>
      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-medium">
          Numéro de mobile
        </label>
        <div className="flex">
          <span className="inline-flex h-12 items-center rounded-l-[var(--radius-control)] border border-r-0 border-line bg-surface-muted px-3 text-ink-muted">
            +225
          </span>
          <input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="07 07 07 07 07"
            value={phone}
            onChange={(e) => setPhone(formatLocalPhone(e.target.value))}
            aria-invalid={!!error}
            aria-describedby={error ? 'phone-error' : 'phone-help'}
            className="field rounded-l-none"
            maxLength={14}
          />
        </div>
        {error ? (
          <p id="phone-error" role="alert" className="mt-1 text-sm text-danger">
            {error}
          </p>
        ) : (
          <p id="phone-help" className="mt-1 text-sm text-ink-muted">
            Mobile Moov (01), MTN (05) ou Orange (07).
          </p>
        )}
      </div>
      <button type="submit" className="btn-primary" disabled={sending}>
        {sending ? 'Envoi du code…' : 'Recevoir un code'}
      </button>
      <p className="text-xs text-ink-muted">
        En continuant, vous pourrez lire les <Link href="/conditions" className="underline">conditions d’utilisation</Link> et la{' '}
        <Link href="/confidentialite" className="underline">politique de confidentialité</Link> avant de les accepter.
      </p>
    </form>
  );
}
