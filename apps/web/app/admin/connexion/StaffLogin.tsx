'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  const [testLogin, setTestLogin] = useState<{ enabled: boolean; needsCode: boolean }>({ enabled: false, needsCode: false });
  const [testCode, setTestCode] = useState('');

  useEffect(() => {
    adminAuth.testLoginStatus().then(setTestLogin, () => setTestLogin({ enabled: false, needsCode: false }));
  }, []);

  async function enterTest() {
    setBusy(true);
    setError(null);
    try {
      const { staff } = await adminAuth.testLogin(testLogin.needsCode ? testCode.trim() : undefined);
      setMe(staff);
      router.replace(next);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

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
      {testLogin.enabled && (
        <div className="grid gap-2 rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-sm">
          <p>
            {testLogin.needsCode
              ? 'Mode essai : entrée avec le code d’essai affiché dans la fenêtre de l’API sur le PC.'
              : 'Mode essai (ordinateur local) : entrée directe, sans mot de passe ni code, avec un compte d’essai.'}
          </p>
          {testLogin.needsCode && (
            <label className="grid gap-1 font-medium">
              Code d’essai
              <input className="field tabular-nums" autoComplete="off" value={testCode} onChange={(e) => setTestCode(e.target.value)} />
            </label>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={busy || (testLogin.needsCode && testCode.trim().length < 8)}
            onClick={() => void enterTest()}
          >
            {testLogin.needsCode ? 'Entrer avec le code d’essai' : 'Entrer sans mot de passe'}
          </button>
        </div>
      )}
      {testLogin.enabled && <p className="text-xs text-ink-muted">Ou, avec un vrai compte du personnel :</p>}
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
