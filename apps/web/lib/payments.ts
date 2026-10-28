import { send } from './account';
import type { BookingStatus, PaymentStatus as BookingPaymentStatus } from './bookings';

export type MobileMoneyMethod = 'WAVE' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'MOOV_MONEY';
export type PaymentStatus = 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface PaymentMethods {
  provider: string;
  sandbox: boolean;
  methods: { code: MobileMoneyMethod; label: string }[];
  cashEnabled: boolean;
}

export interface NextAction {
  type: 'REDIRECT' | 'USSD_PUSH' | 'DEEPLINK';
  url?: string;
  instructions: string;
}

export interface Payment {
  id: string;
  bookingId: string;
  bookingReference: string;
  status: PaymentStatus;
  method: MobileMoneyMethod;
  amountXof: number;
  payerPhoneMasked: string | null;
  expiresAt: string;
  holdExpiresAt: string | null;
  succeededAt: string | null;
  failureMessage: string | null;
  createdAt: string;
  sandbox: boolean;
  booking: { status: BookingStatus; paymentStatus: BookingPaymentStatus };
  nextAction?: NextAction | null;
}

export interface Transaction {
  kind: 'PAYMENT' | 'REFUND';
  id: string;
  bookingId: string;
  bookingReference: string;
  amountXof: number;
  status: string;
  method: MobileMoneyMethod | null;
  reason: string | null;
  createdAt: string;
  route: string;
}

export interface EarningsBooking {
  reference: string;
  bookingStatus: BookingStatus;
  seats: number;
  grossXof: number;
  commissionXof: number;
  netXof: number;
  adjustmentXof: number;
  dueXof: number;
  status: 'PENDING' | 'PAYABLE' | 'IN_PAYOUT' | 'PAID' | 'VOID';
  payableAt: string | null;
}

export interface Earnings {
  totals: { grossXof: number; commissionXof: number; pendingXof: number; payableXof: number; paidXof: number };
  trips: { tripId: string; publicRef: string; departureAt: string; tripStatus: string; origin: string; destination: string; dueXof: number; bookings: EarningsBooking[] }[];
  payoutsAvailable: boolean;
}

export const METHOD_LABEL: Record<MobileMoneyMethod, string> = {
  WAVE: 'Wave',
  ORANGE_MONEY: 'Orange Money',
  MTN_MOMO: 'MTN MoMo',
  MOOV_MONEY: 'Moov Money',
};

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  CREATED: 'En préparation',
  PENDING: 'En attente de validation',
  SUCCEEDED: 'Réussi',
  FAILED: 'Refusé',
  EXPIRED: 'Expiré',
  CANCELLED: 'Annulé',
};

const REFUND_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Demandé',
  APPROVED: 'Approuvé',
  PROCESSING: 'En cours',
  SUCCEEDED: 'Remboursé',
  FAILED: 'Échec, nouvel essai prévu',
  REJECTED: 'Refusé',
  MANUAL_REQUIRED: 'Traitement manuel par l’équipe',
};

export const REFUND_REASON_LABEL: Record<string, string> = {
  DRIVER_CANCELLED: 'annulation par le conducteur',
  PASSENGER_CANCELLED: 'votre annulation',
  TRIP_CHANGED: 'trajet modifié',
  DRIVER_LATE: 'retard du conducteur',
  LATE_PAYMENT: 'paiement arrivé après expiration',
  TRIP_NOT_STARTED: 'trajet non effectué',
  DISPUTE: 'réclamation',
  ADMIN: 'décision d’IvoireCovoit',
};

export const EARNING_STATUS_LABEL: Record<EarningsBooking['status'], string> = {
  PENDING: 'En attente (48 h après le trajet)',
  PAYABLE: 'Disponible',
  IN_PAYOUT: 'Versement en cours',
  PAID: 'Versé',
  VOID: 'Annulé (passager remboursé)',
};

export function transactionStatusLabel(t: Pick<Transaction, 'kind' | 'status'>): string {
  return t.kind === 'PAYMENT' ? (PAYMENT_STATUS_LABEL[t.status as PaymentStatus] ?? t.status) : (REFUND_STATUS_LABEL[t.status] ?? t.status);
}

/** Numéro mobile ivoirien à 10 chiffres (07…, 05…, 01…), avec ou sans +225 et espaces. */
export function isCiMobile(input: string): boolean {
  const digits = input.replace(/[\s.-]/g, '').replace(/^(\+225|00225)/, '');
  return /^(01|05|07)\d{8}$/.test(digits);
}

export type Outcome =
  | { kind: 'waiting' }
  | { kind: 'confirmed' }
  | { kind: 'late'; text: string }
  | { kind: 'failed'; text: string; canRetry: boolean };

/**
 * Ce que l'écran affiche, d'après le statut obtenu par le serveur (jamais d'après le retour de la page de paiement).
 * `holdOpen` : le blocage des places court encore.
 */
export function paymentOutcome(p: Pick<Payment, 'status' | 'failureMessage' | 'booking'>, holdOpen: boolean): Outcome {
  if (p.status === 'CREATED' || p.status === 'PENDING') return { kind: 'waiting' };
  if (p.status === 'SUCCEEDED') {
    if (p.booking.status === 'CONFIRMED' || p.booking.status === 'COMPLETED') return { kind: 'confirmed' };
    return {
      kind: 'late',
      text: 'Paiement reçu après la fin du délai : les places n’étaient plus disponibles. Vous êtes remboursé intégralement, automatiquement.',
    };
  }
  const canRetry = p.booking.status === 'PENDING_PAYMENT' && holdOpen;
  const reason = p.failureMessage ?? 'Le paiement n’a pas abouti.';
  return { kind: 'failed', text: canRetry ? `${reason} Rien ne vous a été débité. Vous pouvez réessayer.` : `${reason} Rien ne vous a été débité.`, canRetry };
}

const idem = (key: string) => ({ 'Idempotency-Key': key });

export const payments = {
  methods: () => send<PaymentMethods>('/bff/api/payments/methods', 'GET'),
  initiate: (bookingId: string, body: { method: MobileMoneyMethod; payerPhone: string }, key: string) =>
    send<Payment>(`/bff/api/bookings/${bookingId}/payments`, 'POST', body, idem(key)),
  get: (id: string) => send<Payment>(`/bff/api/payments/${id}`, 'GET'),
  transactions: (cursor?: string) =>
    send<{ data: Transaction[]; nextCursor: string | null }>(`/bff/api/me/transactions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET'),
  earnings: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const s = q.toString();
    return send<Earnings>(`/bff/api/me/earnings${s ? `?${s}` : ''}`, 'GET');
  },
};
