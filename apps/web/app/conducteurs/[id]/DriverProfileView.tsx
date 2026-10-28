'use client';

import { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { ApiRequestError } from '@/lib/api';
import { type PublicDriver, publicTrips } from '@/lib/trips';

const monthYear = new Intl.DateTimeFormat('fr-CI', { month: 'long', year: 'numeric', timeZone: 'Africa/Abidjan' });

const CHAT: Record<string, string> = { QUIET: 'Plutôt calme', SOME: 'Discute selon l’humeur', CHATTY: 'Aime discuter' };
const LANG: Record<string, string> = {
  fr: 'Français', en: 'Anglais', dioula: 'Dioula', baoule: 'Baoulé', bete: 'Bété', senoufo: 'Sénoufo', agni: 'Agni', autre: 'Autre',
};

/** Écran 7 : profil public d'un conducteur vérifié. Aucune donnée de contact ni pièce justificative. */
export function DriverProfileView({ id }: { id: string }) {
  const [driver, setDriver] = useState<PublicDriver | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    publicTrips.driver(id, controller.signal).then(setDriver, (err: unknown) => {
      if (controller.signal.aborted) return;
      setError(err instanceof ApiRequestError && err.status === 404 ? 'Ce profil n’existe pas ou n’est pas public.' : 'Impossible de charger ce profil.');
    });
    return () => controller.abort();
  }, [id]);

  if (error) return <p role="alert" className="card text-danger">{error}</p>;
  if (!driver) return <p className="card text-ink-muted">Chargement du profil…</p>;

  const prefs = driver.preferences;
  const prefItems = [
    prefs.music !== undefined && (prefs.music ? 'Musique pendant le trajet' : 'Pas de musique'),
    prefs.pets !== undefined && (prefs.pets ? 'Animaux acceptés' : 'Pas d’animaux'),
    prefs.smoking !== undefined && (prefs.smoking ? 'Fumeur (pauses)' : 'Non-fumeur'),
    prefs.chat && CHAT[prefs.chat],
    prefs.languages?.length && `Parle ${prefs.languages.map((l) => LANG[l] ?? l).join(', ')}`,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <section className="card flex items-center gap-4">
        <Avatar name={driver.displayName} url={driver.photoUrl} size="h-20 w-20 text-2xl" />
        <div>
          <h1 className="text-2xl font-bold">
            {driver.displayName}
            {driver.isDemo && <span className="ml-2 rounded bg-warning-soft px-1 align-middle text-xs font-normal">[DEMO]</span>}
          </h1>
          <p className="text-success">
            ✓ Identité et permis vérifiés{driver.verificationLevel >= 2 ? ', véhicule vérifié' : ''}
          </p>
          <p className="text-sm text-ink-muted">Membre depuis {monthYear.format(new Date(driver.memberSince))}</p>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-3 text-center" aria-label="Chiffres clés">
        <Stat value={driver.ratingAvg !== null ? `★ ${driver.ratingAvg.toFixed(1)}` : '—'} label={`${driver.ratingCount} avis`} />
        <Stat value={String(driver.completedTripsCount)} label="trajets effectués" />
        <Stat value={String(driver.upcomingTripsCount)} label="trajets à venir" />
      </section>

      {(driver.bio || prefItems.length > 0) && (
        <section aria-labelledby="about" className="card grid gap-2">
          <h2 id="about" className="text-lg font-semibold">
            À propos
          </h2>
          {driver.bio && <p className="whitespace-pre-line">{driver.bio}</p>}
          {prefItems.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {prefItems.map((p) => (
                <li key={p} className="rounded-full bg-surface-muted px-3 py-1 text-sm">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {driver.vehicles.length > 0 && (
        <section aria-labelledby="vehicles" className="card">
          <h2 id="vehicles" className="mb-2 text-lg font-semibold">
            Véhicule{driver.vehicles.length > 1 ? 's' : ''}
          </h2>
          <ul className="grid gap-1">
            {driver.vehicles.map((v, i) => (
              <li key={i}>
                {v.make} {v.model}, {v.color}
                {v.year ? ` (${v.year})` : ''} · {v.seats} place{v.seats > 1 ? 's' : ''} passagers
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="reviews" className="card">
        <h2 id="reviews" className="mb-2 text-lg font-semibold">
          Avis des passagers
        </h2>
        {driver.reviews.length === 0 ? (
          <p className="text-ink-muted">Pas encore d’avis publié.</p>
        ) : (
          <ul className="divide-y divide-line">
            {driver.reviews.map((r) => (
              <li key={r.id} className="py-2">
                <p className="font-medium">
                  <span aria-label={`${r.rating} sur 5`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>{' '}
                  <span className="text-sm text-ink-muted">{r.author ?? 'Passager'}</span>
                </p>
                {r.comment && <p className="text-sm">{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="card">
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}
