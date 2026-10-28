'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { OtpInput } from '@/components/OtpInput';
import { auth, browserDeviceLabel, FieldErrors, formatLocalPhone } from '@/lib/account';
import { ApiRequestError } from '@/lib/api';
import { clearPendingOtp, parsePendingOtp, type PendingOtp, readPendingOtpRaw, savePendingOtp } from '@/lib/pending-otp';
import { useNow } from '@/lib/use-now';

const subscribe = () => () => {};

function formatSeconds(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Écran 3 : six cases, collage automatique, renvoi possible après 60 s, compte à rebours de validité. */
export function CodeForm() {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribe, readPendingOtpRaw, () => null);
  const initial = useMemo(() => parsePendingOtp(raw), [raw]);
  const [override, setOverride] = useState<PendingOtp | null>(null);
  const pending = override ?? initial;
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const now = useNow();

  if (!pending) {
    return (
      <div className="card grid gap-3">
        <h1 className="text-2xl font-bold">Code de vérification</h1>
        <p className="text-ink-muted">Aucune demande de code en cours.</p>
        <Link href="/connexion" className="btn-primary">
          Saisir mon numéro
        </Link>
      </div>
    );
  }

  const elapsedS = Math.floor((now - pending.sentAt) / 1000);
  const resendIn = Math.max(0, pending.resendAfterS - elapsedS);
  const expiresIn = Math.max(0, pending.expiresInS - elapsedS);

  async function verify(value: string) {
    if (!pending || busy) return;
    if (!/^\d{6}$/.test(value)) {
      setError('Saisissez les 6 chiffres reçus par SMS.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user } = await auth.verifyOtp(pending.otpRequestId, value, browserDeviceLabel());
      clearPendingOtp();
      const dest = user.profileComplete ? pending.next : `/inscription/profil?next=${encodeURIComponent(pending.next)}`;
      router.replace(dest);
      router.refresh();
    } catch (err) {
      setCode('');
      if (err instanceof FieldErrors && err.code === 'OTP_INVALID' && typeof err.details.remainingAttempts === 'number') {
        const n = err.details.remainingAttempts;
        setError(`Code incorrect. Il vous reste ${n} essai${n > 1 ? 's' : ''}.`);
      } else {
        setError(err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');
      }
      setBusy(false);
    }
  }

  async function resend() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const otp = await auth.requestOtp(`+225${pending.phone}`);
      const next = { ...pending, ...otp, sentAt: Date.now() };
      savePendingOtp(next);
      setOverride(next);
      setCode('');
      setInfo('Un nouveau code vous a été envoyé.');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="card grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
    >
      <div>
        <h1 className="text-2xl font-bold">Saisissez le code</h1>
        <p className="mt-1 text-ink-muted">
          Envoyé par SMS au <strong className="text-ink">+225 {formatLocalPhone(pending.phone)}</strong>.{' '}
          <Link href="/connexion" className="underline">
            Modifier
          </Link>
        </p>
      </div>

      {pending.testCode && (
        <p role="note" className="rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-sm">
          Mode test (développement) : aucun SMS n’est envoyé. Code : <strong className="tabular-nums">{pending.testCode}</strong>
        </p>
      )}

      <OtpInput
        value={code}
        onChange={(v) => {
          setCode(v);
          setError(null);
          setInfo(null);
        }}
        onComplete={(v) => void verify(v)}
        disabled={busy || expiresIn === 0}
        invalid={!!error}
        describedBy="otp-status"
      />

      <div id="otp-status" aria-live="polite" className="min-h-6 text-sm">
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : info ? (
          <p className="text-success">{info}</p>
        ) : expiresIn > 0 ? (
          <p className="text-ink-muted">Code valable encore {formatSeconds(expiresIn)}.</p>
        ) : (
          <p className="text-danger">Ce code a expiré. Demandez-en un nouveau.</p>
        )}
      </div>

      <button type="submit" className="btn-primary" disabled={busy || code.length !== 6 || expiresIn === 0}>
        {busy ? 'Vérification…' : 'Valider'}
      </button>
      <button type="button" className="btn-secondary" onClick={() => void resend()} disabled={busy || resendIn > 0}>
        {resendIn > 0 ? `Renvoyer le code dans ${resendIn} s` : 'Renvoyer le code'}
      </button>
      <p className="text-xs text-ink-muted">Ne communiquez jamais ce code, même à une personne qui se présente comme le support.</p>
    </form>
  );
}
