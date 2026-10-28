import { ApiRequestError, type ApiErrorBody } from './api';

export type ConsentType = 'TERMS' | 'PRIVACY' | 'LOCATION_LIVE' | 'MARKETING';

export interface Preferences {
  smoking?: boolean;
  music?: boolean;
  pets?: boolean;
  chat?: 'QUIET' | 'SOME' | 'CHATTY';
  languages?: string[];
}

export interface Me {
  id: string;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  bio: string | null;
  /** URL signée temporaire (1 h), ou null. */
  photoUrl: string | null;
  preferences: Preferences;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';
  profileComplete: boolean;
  isDemo: boolean;
  consents: { type: ConsentType; version: string; granted: boolean; at: string }[];
  requiredConsents: { type: 'TERMS' | 'PRIVACY'; version: string; accepted: boolean }[];
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

export interface OtpRequest {
  otpRequestId: string;
  expiresInS: number;
  resendAfterS: number;
  /** Uniquement en mode OTP de test (développement). */
  testCode?: string;
}

export interface SignedUpload {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export class FieldErrors extends ApiRequestError {
  constructor(
    code: string,
    message: string,
    status: number,
    readonly fields: Record<string, string>,
    readonly details: Record<string, unknown>,
  ) {
    super(code, message, status);
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

const NETWORK_MESSAGE = 'Connexion impossible. Vérifiez votre réseau puis réessayez.';

/** Appel JSON avec jeton CSRF ; les erreurs portent le détail par champ renvoyé par l'API. */
export async function send<T>(url: string, method: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = readCookie('ic_csrf');
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiRequestError('NETWORK_ERROR', NETWORK_MESSAGE, 0);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const err = data?.error;
    const details = (err?.details ?? {}) as Record<string, unknown>;
    throw new FieldErrors(
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? 'Le service est momentanément indisponible.',
      res.status,
      (details.fields as Record<string, string>) ?? {},
      details,
    );
  }
  return data as T;
}

/** Appels de l'espace personnel, via le relais authentifié du serveur web. */
export const account = {
  me: () => send<Me>('/bff/api/me', 'GET'),
  update: (patch: Partial<Pick<Me, 'firstName' | 'lastName' | 'bio' | 'email' | 'preferences'>>) =>
    send<Me>('/bff/api/me', 'PATCH', patch),
  consent: (type: ConsentType, version: string, granted: boolean) =>
    send<Me>('/bff/api/me/consents', 'PUT', { type, version, granted }),
  emergencyContact: () => send<{ data: { name: string; phone: string } | null }>('/bff/api/me/emergency-contact', 'GET'),
  setEmergencyContact: (name: string, phone: string) =>
    send<{ data: { name: string; phone: string } }>('/bff/api/me/emergency-contact', 'PUT', { name, phone }),
  sessions: () => send<{ data: SessionInfo[] }>('/bff/api/auth/sessions', 'GET'),
  revokeSession: (id: string) => send<void>(`/bff/api/auth/sessions/${id}`, 'DELETE'),
  revokeAll: () => send<{ revoked: number }>('/bff/api/auth/sessions/all', 'DELETE'),
  logout: () => send<void>('/bff/auth/logout', 'POST'),
  photoUploadUrl: (meta: { mimeType: string; sizeBytes: number; sha256: string }) =>
    send<{ upload: SignedUpload }>('/bff/api/me/photo/upload-url', 'POST', meta),
  photoComplete: () => send<Me>('/bff/api/me/photo/complete', 'POST'),
  photoDelete: () => send<Me>('/bff/api/me/photo', 'DELETE'),
  deletionOtp: () => send<OtpRequest>('/bff/api/me/deletion/otp', 'POST'),
  deleteAccount: (otpRequestId: string, code: string) => send<void>('/bff/api/me', 'DELETE', { otpRequestId, code }),
};

export const auth = {
  requestOtp: (phone: string) => send<OtpRequest>('/api/v1/auth/otp/request', 'POST', { phone, purpose: 'LOGIN' }),
  verifyOtp: (otpRequestId: string, code: string, deviceLabel: string) =>
    send<{ user: Me; isNewUser: boolean }>('/bff/auth/otp/verify', 'POST', { otpRequestId, code, deviceLabel }),
};

/** « 0707070707 » ou « 07 07 07 07 07 » → 10 chiffres, ou null. Contrôle de forme seulement : l'API tranche. */
export function localMobileDigits(input: string): string | null {
  const digits = input.replace(/\D/g, '').replace(/^225(?=\d{10}$)/, '');
  return /^0[157]\d{8}$/.test(digits) ? digits : null;
}

export function formatLocalPhone(digits: string): string {
  return digits.replace(/\D/g, '').slice(0, 10).replace(/(\d{2})(?=\d)/g, '$1 ');
}

export function browserDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Navigateur';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} sur ${os}` : browser;
}
