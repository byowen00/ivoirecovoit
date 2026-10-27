export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown>; requestId?: string };
}

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const NETWORK_MESSAGE = 'Connexion impossible. Vérifiez votre réseau puis réessayez.';

/**
 * Appel GET vers l'API avec délai d'attente et nouvelles tentatives (connexions instables).
 * Seules les requêtes sans effet de bord sont rejouées automatiquement.
 */
export async function apiGet<T>(
  path: string,
  { signal, timeoutMs = 10_000, retries = 2 }: { signal?: AbortSignal; timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const res = await fetch(`/api/v1${path}`, { signal: combined, headers: { Accept: 'application/json' } });
      if (res.ok) return (await res.json()) as T;
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      const err = new ApiRequestError(
        body?.error.code ?? 'HTTP_ERROR',
        body?.error.message ?? 'Le service est momentanément indisponible.',
        res.status,
      );
      if (res.status < 500) throw err; // erreur du client : inutile de réessayer
      lastError = err;
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof ApiRequestError && err.status < 500) throw err;
      lastError = err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  if (lastError instanceof ApiRequestError) throw lastError;
  throw new ApiRequestError('NETWORK_ERROR', NETWORK_MESSAGE, 0);
}
