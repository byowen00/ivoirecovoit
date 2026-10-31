'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { ageText, live, type LiveLocation } from '@/lib/live';
import { TripMap } from './TripMap';

const REFRESH_MS = 10_000;

/** Passager confirmé : la voiture sur la carte, actualisée toutes les 10 s. */
export function LiveTripMap({ tripId }: { tripId: string }) {
  const [data, setData] = useState<LiveLocation | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = () =>
      live.read(tripId).then(
        (d) => !stop && (setData(d), setError(false)),
        () => !stop && setError(true),
      );
    void tick();
    const timer = setInterval(() => void tick(), REFRESH_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [tripId]);

  const p = data?.position;
  const points = useMemo(() => (p ? [{ lat: p.lat, lng: p.lng, label: 'Voiture', tone: 'vehicle' as const }] : []), [p?.lat, p?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card grid gap-2" aria-labelledby="live-title">
      <h2 id="live-title" className="text-lg font-semibold">
        Où est la voiture ?
      </h2>
      {!p ? (
        <p className="text-sm text-ink-muted">{error ? 'Position indisponible pour le moment.' : 'Le conducteur ne partage pas sa position pour le moment.'}</p>
      ) : (
        <>
          <TripMap points={points} label="Position du conducteur" className="h-64" caption="Position envoyée par le téléphone du conducteur, elle peut être imprécise ou en retard." />
          <p className={`text-sm ${data.stale ? 'text-danger' : 'text-ink-muted'}`} role="status">
            Mise à jour {ageText(data.ageS ?? 0)}
            {data.stale ? ' : le conducteur n’envoie plus sa position (réseau ou appli fermée).' : '.'}
          </p>
        </>
      )}
    </section>
  );
}

/** Conducteur : partage sa position tant que la page reste ouverte. */
export function ShareLocation({ tripId }: { tripId: string }) {
  const [on, setOn] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (!on) return;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last.current < REFRESH_MS) return;
        last.current = Date.now();
        const { latitude, longitude, accuracy, heading } = pos.coords;
        live
          .share(tripId, { lat: latitude, lng: longitude, accuracyM: Math.min(10000, Math.round(accuracy)), ...(heading != null && !Number.isNaN(heading) ? { heading } : {}) })
          .then(
            () => setInfo('Position envoyée aux passagers confirmés.'),
            (err: unknown) => setInfo(err instanceof ApiRequestError ? err.message : 'Envoi impossible, nouvel essai bientôt.'),
          );
      },
      () => {
        setInfo('Accès à la position refusé.');
        setOn(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [on, tripId]);

  return (
    <section className="card grid gap-2" aria-labelledby="share-title">
      <h2 id="share-title" className="text-lg font-semibold">
        Partager ma position
      </h2>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => {
            if (e.target.checked && !('geolocation' in navigator)) return setInfo('Ce navigateur ne donne pas la position.');
            setOn(e.target.checked);
          }} />
        Les passagers confirmés voient la voiture sur la carte
      </label>
      <p className="text-xs text-ink-muted">Seulement pendant le trajet et tant que cette page reste ouverte. Seule la dernière position est gardée, 15 minutes au plus.</p>
      {info && <p className="text-sm text-ink-muted" role="status">{info}</p>}
    </section>
  );
}
