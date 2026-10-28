'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ReportForm } from '@/components/ReportForm';
import { StarRating } from '@/components/StarRating';
import { formatDay, formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import type { Booking } from '@/lib/bookings';
import { useNow } from '@/lib/use-now';
import { type DisputeEligibility, DISPUTE_STATUS_LABEL, type DisputeStatus, type ReviewStatus, shareMessage, type ShareLink, trust } from '@/lib/trust';

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');

/** Messagerie, partage du trajet, avis, réclamation et signalement depuis une réservation. */
export function BookingTrust({ b, onChange }: { b: Booking; onChange: () => void }) {
  const isDriver = b.viewerRole === 'DRIVER';
  const otherId = isDriver ? b.passenger.id : b.trip.driver.id;
  const [reporting, setReporting] = useState(false);
  const now = useNow(60_000);
  const started = now >= new Date(b.trip.departureAt).getTime() || b.status.startsWith('CANCELLED') || b.status === 'COMPLETED';

  return (
    <>
      <section className="card grid gap-3" aria-labelledby="contact-title">
        <h2 id="contact-title" className="text-lg font-semibold">
          Échanger et voyager en sécurité
        </h2>
        <div className="flex flex-wrap gap-2">
          {(b.actions.canMessage || b.status === 'COMPLETED') && (
            <Link href={`/reservations/${b.id}/messages`} className="btn-secondary">
              {b.actions.canMessage ? `Écrire au ${isDriver ? 'passager' : 'conducteur'}` : 'Revoir les messages'}
            </Link>
          )}
          <Link href="/aide#urgence" className="btn-secondary">
            Numéros d’urgence
          </Link>
          <button type="button" className="btn-secondary" onClick={() => setReporting(true)}>
            Signaler {isDriver ? 'le passager' : 'le conducteur'}
          </button>
        </div>
        {b.actions.canShare && <ShareBlock b={b} />}
      </section>

      {reporting && (
        <ReportForm targetType="USER" targetId={otherId} bookingId={b.id} title={`Signaler ${isDriver ? 'le passager' : 'le conducteur'}`} onDone={() => setReporting(false)} />
      )}

      {b.status === 'COMPLETED' && <ReviewBlock b={b} onChange={onChange} />}
      {(started || b.openDispute) && <DisputeBlock b={b} />}
    </>
  );
}

function ShareBlock({ b }: { b: Booking }) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [active, setActive] = useState<{ active: boolean; expiresAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    trust.shareStatus(b.id).then(setActive, () => undefined);
  }, [b.id]);

  async function create() {
    setError(null);
    try {
      const l = await trust.createShare(b.id);
      setLink(l);
      setActive({ active: true, expiresAt: l.expiresAt });
    } catch (err) {
      setError(message(err));
    }
  }
  async function revoke() {
    setError(null);
    try {
      await trust.revokeShare(b.id);
      setLink(null);
      setActive({ active: false, expiresAt: null });
    } catch (err) {
      setError(message(err));
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError('Copie impossible : sélectionnez le lien pour le copier.');
    }
  }

  const text = link ? shareMessage(link.url, `${b.pickup.label} → ${b.dropoff.label}`) : '';
  return (
    <div className="grid gap-2 border-t border-line pt-3">
      <h3 className="font-semibold">Partager mon trajet avec un proche</h3>
      <p className="text-sm text-ink-muted">
        Le lien montre le trajet, les horaires estimés, le prénom du conducteur et le véhicule. Il ne donne aucune position GPS et expire après l’arrivée.
      </p>
      {link ? (
        <>
          <input readOnly className="field" value={link.url} aria-label="Lien de partage" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => void copy(link.url)}>
              {copied ? 'Lien copié' : 'Copier le lien'}
            </button>
            <a className="btn-secondary" href={`sms:?&body=${encodeURIComponent(text)}`}>
              Envoyer par SMS
            </a>
            <a className="btn-secondary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
              Envoyer par WhatsApp
            </a>
          </div>
        </>
      ) : (
        <button type="button" className="btn-secondary justify-self-start" onClick={() => void create()}>
          {active?.active ? 'Créer un nouveau lien (l’ancien ne marchera plus)' : 'Créer un lien de partage'}
        </button>
      )}
      {active?.active && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          Lien actif{active.expiresAt ? ` jusqu’au ${formatDay(active.expiresAt)} à ${formatTime(active.expiresAt)}` : ''}.
          <button type="button" className="font-semibold text-danger underline" onClick={() => void revoke()}>
            Désactiver le lien
          </button>
        </p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function ReviewBlock({ b, onChange }: { b: Booking; onChange: () => void }) {
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    trust.reviewStatus(b.id).then(setStatus, () => undefined);
  }, [b.id]);
  if (!status || (!status.canReview && !status.mine)) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStatus(await trust.review(b.id, rating, comment.trim() || undefined));
      onChange();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const who = status.subjectRole === 'DRIVER' ? 'le conducteur' : 'le passager';
  return (
    <section className="card grid gap-2" aria-labelledby="review-title">
      <h2 id="review-title" className="text-lg font-semibold">
        Votre avis sur {who}
      </h2>
      {status.mine ? (
        <p className="text-sm">
          Vous avez donné {status.mine.rating}/5{status.mine.comment ? ` : « ${status.mine.comment} »` : ''}.{' '}
          <span className="text-ink-muted">
            {status.mine.published
              ? 'Avis publié.'
              : 'Il sera publié quand l’autre personne aura donné le sien, ou à la fin du délai : personne ne voit l’avis de l’autre avant.'}
          </span>
        </p>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="grid gap-2">
          <StarRating value={rating} onChange={setRating} />
          <label htmlFor="review-comment" className="text-sm font-medium">
            Commentaire (facultatif, public)
          </label>
          <textarea id="review-comment" rows={2} maxLength={500} className="field h-auto py-2" value={comment} onChange={(e) => setComment(e.target.value)} />
          {status.deadline && <p className="text-xs text-ink-muted">Possible jusqu’au {formatDay(status.deadline)}.</p>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button type="submit" className="btn-primary justify-self-start" disabled={busy || rating === 0}>
            Publier mon avis
          </button>
        </form>
      )}
    </section>
  );
}

function DisputeBlock({ b }: { b: Booking }) {
  const [elig, setElig] = useState<DisputeEligibility | null>(null);
  useEffect(() => {
    if (!b.openDispute) trust.disputeEligibility(b.id).then(setElig, () => undefined);
  }, [b.id, b.openDispute]);

  if (b.openDispute) {
    return (
      <section className="card grid gap-1 text-sm" aria-label="Réclamation">
        <p>
          Réclamation {b.openDispute.reference} : {DISPUTE_STATUS_LABEL[b.openDispute.status as DisputeStatus] ?? b.openDispute.status}.
        </p>
        <Link href={`/aide/reclamations/${b.openDispute.id}`} className="font-semibold text-brand">
          Suivre la réclamation
        </Link>
      </section>
    );
  }
  if (!elig?.allowed) return null;
  return (
    <section className="card grid gap-1 text-sm" aria-label="Réclamation">
      <p>
        Un problème avec ce trajet (absence, retard, montant) ? Vous pouvez ouvrir une réclamation jusqu’au {formatDay(elig.deadline)}.
      </p>
      <Link href={`/aide/reclamations/nouvelle?reservation=${b.id}`} className="font-semibold text-brand">
        Ouvrir une réclamation
      </Link>
    </section>
  );
}
