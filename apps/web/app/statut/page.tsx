'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, ApiRequestError } from '@/lib/api';

interface Health {
  status: string;
  database: string;
  postgis: string;
}

interface HealthResult {
  health: Health | null;
  error: string | null;
}

async function fetchHealth(): Promise<HealthResult> {
  try {
    return { health: await apiGet<Health>('/health', { retries: 1 }), error: null };
  } catch (err) {
    return { health: null, error: err instanceof ApiRequestError ? err.message : 'Service injoignable.' };
  }
}

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((result: HealthResult) => {
    setHealth(result.health);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchHealth().then((r) => active && apply(r));
    return () => {
      active = false;
    };
  }, [apply]);

  function retry() {
    setLoading(true);
    void fetchHealth().then(apply);
  }

  return (
    <section className="max-w-md rounded-[var(--radius-card)] bg-surface p-6 shadow-sm" aria-live="polite">
      <h1 className="text-2xl font-bold">État du service</h1>
      {loading && <p className="mt-4 text-ink-muted">Vérification en cours…</p>}
      {!loading && health && (
        <ul className="mt-4 grid gap-2">
          <li className="rounded-lg bg-success-soft px-3 py-2 text-success">API : opérationnelle</li>
          <li className="rounded-lg bg-success-soft px-3 py-2 text-success">Base de données : opérationnelle</li>
          <li className="text-sm text-ink-muted">PostGIS {health.postgis}</li>
        </ul>
      )}
      {!loading && error && <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      <button
        type="button"
        onClick={retry}
        className="mt-6 h-12 w-full rounded-[var(--radius-control)] border border-line font-medium"
      >
        Réessayer
      </button>
    </section>
  );
}
