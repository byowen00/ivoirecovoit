'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminAuth } from '@/lib/admin';
import { useSetStaff } from '../_components/AdminShell';
import { errText } from '../_components/ui';

/** Connexion du personnel : e-mail, mot de passe et code à 6 chiffres de l'application d'authentification. */
export function StaffLogin({ next }: { next: string }) {
  const router = useRouter();
  const setMe = useSetStaff();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { staff } = await adminAuth.login(email.trim(), password, totp.trim());
      setMe(staff);
      router.replace(next);
    } catch (err) {
      setError(errText(err));
      setTotp('');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card mx-auto grid w-full max-w-sm gap-3" aria-labelledby="staff-login-title">
      <h1 id="staff-login-title" className="text-xl font-bold">
        Console d’administration
      </h1>
      <p className="text-sm text-ink-muted">Réservée au personnel d’IvoireCovoit. Chaque action est journalisée.</p>
      <label className="grid gap-1 text-sm font-medium">
        Adresse e-mail
        <input type="email" autoComplete="username" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Mot de passe
        <input type="password" autoComplete="current-password" required className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Code de l’application d’authentification
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className="field tracking-widest tabular-nums"
          value={totp}
          onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy || totp.length !== 6}>
        Se connecter
      </button>
    </form>
  );
}
