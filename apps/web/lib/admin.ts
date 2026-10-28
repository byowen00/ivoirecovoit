import { send } from './account';
import { newIdempotencyKey } from './trips';

/** Appel de la console vers /api/v1/admin/* via le relais du personnel (cookies et CSRF distincts). */
export function adminCall<T>(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  return send<T>(`/bff/admin/api/${path.replace(/^\//, '')}`, method, body, headers, 'ic_admin_csrf');
}

export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export interface StaffMe {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  permissions: string[];
}

export function can(me: StaffMe | null, ...anyOf: string[]): boolean {
  if (!me) return false;
  if (me.permissions.includes('*')) return true;
  return anyOf.length === 0 || anyOf.some((p) => me.permissions.includes(p));
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export const adminAuth = {
  login: (email: string, password: string, totp: string) =>
    send<{ staff: StaffMe }>('/bff/admin/login', 'POST', { email, password, totp }, {}, 'ic_admin_csrf'),
  logout: () => send<void>('/bff/admin/logout', 'POST', undefined, {}, 'ic_admin_csrf'),
  me: () => adminCall<StaffMe>('me'),
};

export const adminRefund = (body: { bookingId: string; amountXof: number; reasonCode: 'ADMIN' | 'DISPUTE'; note: string }) =>
  adminCall<{ refundId: string; status: 'REQUESTED' | 'APPROVED' }>('refunds', 'POST', body, { 'Idempotency-Key': newIdempotencyKey() });

/** Libellés français des statuts affichés dans la console. */
export const LABELS: Record<string, string> = {
  // trajets
  DRAFT: 'Brouillon', PUBLISHED: 'Publié', FULL: 'Complet', IN_PROGRESS: 'En cours', COMPLETED: 'Terminé', CANCELLED: 'Annulé',
  // réservations
  PENDING_ACCEPTANCE: 'Attente conducteur', PENDING_PAYMENT: 'Attente paiement', CONFIRMED: 'Confirmée', REJECTED: 'Refusée', EXPIRED: 'Expirée',
  CANCELLED_BY_PASSENGER: 'Annulée (passager)', CANCELLED_BY_DRIVER: 'Annulée (conducteur)', CANCELLED_BY_ADMIN: 'Annulée (admin)', NO_SHOW: 'Absent',
  // paiements
  NOT_REQUIRED: 'Non requis', UNPAID: 'Non payé', PROCESSING: 'En cours', PAID: 'Payé', PARTIALLY_REFUNDED: 'Remb. partiel', REFUND_PENDING: 'Remb. en cours',
  REFUNDED: 'Remboursé', CASH_DUE: 'Espèces', CREATED: 'Créé', PENDING: 'En attente', SUCCEEDED: 'Réussi', FAILED: 'Échoué',
  // remboursements, versements, commissions
  REQUESTED: 'À valider', APPROVED: 'Validé', MANUAL_REQUIRED: 'Manuel requis', PAYABLE: 'Disponible', IN_PAYOUT: 'En versement', VOID: 'Annulée',
  // réclamations, signalements
  OPEN: 'Ouvert', AWAITING_RESPONSE: 'Attente réponse', IN_REVIEW: 'En examen', RESOLVED: 'Résolue', CLOSED: 'Close', ACTION_TAKEN: 'Mesure prise',
  DISMISSED: 'Classé',
  // utilisateurs et vérifications
  PENDING_VERIFICATION: 'À vérifier', ACTIVE: 'Actif', SUSPENDED: 'Suspendu', BANNED: 'Banni', DELETED: 'Supprimé', NOT_SUBMITTED: 'Non soumis',
  // gravité
  LOW: 'Faible', MEDIUM: 'Moyenne', HIGH: 'Élevée', CRITICAL: 'Critique',
  // rapprochement
  RUNNING: 'En cours', OK: 'Conforme', DISCREPANCIES: 'Écarts',
  INACTIVE: 'Inactif',
};

export const label = (code: string | null | undefined) => (code ? (LABELS[code] ?? code) : '—');

export const ROLE_LABEL: Record<string, string> = {
  SUPPORT: 'Agent de support',
  ADMIN: 'Administrateur',
  FINANCE: 'Finance',
  SUPER_ADMIN: 'Super-administrateur',
};
