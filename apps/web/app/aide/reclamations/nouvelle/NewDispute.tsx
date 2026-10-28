'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatDay } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { type DisputeEligibility, trust } from '@/lib/trust';

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');

export function NewDispute({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [elig, setElig] = useState<DisputeEligibility | null>(null);
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validId = /^[0-9a-f-]{36}$/i.test(bookingId);

  useEffect(() => {
    if (!validId) return;
    trust.disputeEligibility(bookingId).then(
      (e) => (e.openDisputeId ? router.replace(`/aide/reclamations/${e.openDisputeId}`) : setElig(e)),
      (err: unknown) => {
        if (err instanceof ApiRequestError && err.status === 401) router.replace(`/connexion?next=/aide/reclamations/nouvelle?reservation=${bookingId}`);
        else setError(message(err));
      },
    );
  }, [bookingId, validId, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await trust.openDispute({ bookingId, reasonCode: reason, description: description.trim() });
      router.replace(`/aide/reclamations/${d.id}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div>
        <Link href={bookingId ? `/reservations/${bookingId}` : '/aide'} className="text-sm text-brand">
          ← Retour
        </Link>
        <h1 className="text-2xl font-bold">Ouvrir une réclamation</h1>
      </div>
      {!validId && <p role="alert" className="card text-danger">Ouvrez la réclamation depuis la réservation concernée.</p>}
      {error && <p role="alert" className="card text-danger">{error}</p>}
      {elig && !elig.allowed && (
        <p className="card text-sm">
          Une réclamation n’est pas possible sur cette réservation : elle s’ouvre à partir du départ (ou après une annulation) et jusqu’au{' '}
          {formatDay(elig.deadline)}.
        </p>
      )}
      {elig?.allowed && (
        <form onSubmit={(e) => void submit(e)} className="card grid gap-3">
          <p className="text-sm text-ink-muted">
            L’autre personne pourra donner sa version, puis notre équipe décidera. Vous serez prévenu à chaque étape. Possible jusqu’au {formatDay(elig.deadline)}.
          </p>
          <fieldset className="grid gap-1">
            <legend className="text-sm font-medium">Motif</legend>
            {elig.reasons.map((r) => (
              <label key={r.code} className="flex items-center gap-2">
                <input type="radio" name="reason" value={r.code} checked={reason === r.code} onChange={() => setReason(r.code)} />
                {r.label}
              </label>
            ))}
          </fieldset>
          <label htmlFor="dispute-description" className="text-sm font-medium">
            Expliquez ce qui s’est passé (10 caractères minimum)
          </label>
          <textarea id="dispute-description" rows={4} maxLength={2000} className="field h-auto py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button type="submit" className="btn-primary justify-self-start" disabled={busy || !reason || description.trim().length < 10}>
            Envoyer la réclamation
          </button>
        </form>
      )}
    </div>
  );
}
