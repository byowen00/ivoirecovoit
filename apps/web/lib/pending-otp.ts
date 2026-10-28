import type { OtpRequest } from './account';

/** Demande de code en cours, gardée le temps de passer de l'écran « numéro » à l'écran « code ». */
export interface PendingOtp extends OtpRequest {
  phone: string; // 10 chiffres
  sentAt: number;
  next: string;
}

const KEY = 'ic_pending_otp';

export function savePendingOtp(p: PendingOtp): void {
  sessionStorage.setItem(KEY, JSON.stringify(p));
}

/** Valeur brute (chaîne stable entre deux rendus, utilisable avec useSyncExternalStore). */
export function readPendingOtpRaw(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function parsePendingOtp(raw: string | null): PendingOtp | null {
  try {
    return raw ? (JSON.parse(raw) as PendingOtp) : null;
  } catch {
    return null;
  }
}

export function clearPendingOtp(): void {
  sessionStorage.removeItem(KEY);
}

/** N'accepte que des chemins internes pour la redirection après connexion. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/compte';
}
