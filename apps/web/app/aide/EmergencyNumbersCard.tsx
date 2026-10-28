'use client';

import { useEffect, useState } from 'react';
import { type EmergencyNumbers, trust } from '@/lib/trust';

export function EmergencyNumbersCard() {
  const [data, setData] = useState<EmergencyNumbers | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    trust.emergencyNumbers().then(setData, () => setFailed(true));
  }, []);
  return (
    <section id="urgence" className="card grid gap-2 border-l-4 border-l-danger" aria-labelledby="sos-title">
      <h2 id="sos-title" className="text-lg font-semibold">
        En cas d’urgence
      </h2>
      {failed && <p className="text-sm text-danger">Numéros indisponibles hors connexion : en cas de danger, appelez les secours.</p>}
      {data && (
        <>
          {!data.validated && (
            <p className="rounded bg-warning-soft px-2 py-1 text-xs text-ink">
              Liste en cours de vérification par l’équipe IvoireCovoit{data.notice ? ` (${data.notice})` : ''}.
            </p>
          )}
          <ul className="grid gap-1">
            {data.numbers.map((n) => (
              <li key={n.label} className="flex items-center justify-between gap-2">
                <span>{n.label}</span>
                <a href={`tel:${n.phone}`} className="btn-secondary min-w-20 justify-center tabular-nums">
                  {n.phone}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
