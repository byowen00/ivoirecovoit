import { send } from './account';
import { newIdempotencyKey } from './trips';

export type BookingStatus =
  | 'PENDING_ACCEPTANCE' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED'
  | 'CANCELLED_BY_PASSENGER' | 'CANCELLED_BY_DRIVER' | 'CANCELLED_BY_ADMIN' | 'NO_SHOW' | 'COMPLETED';
export type PaymentStatus = 'NOT_REQUIRED' | 'UNPAID' | 'PROCESSING' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUND_PENDING' | 'REFUNDED' | 'CASH_DUE';

export interface CancellationPolicy {
  code: string;
  label: string;
  summary: string;
}

export interface Quote {
  tripId: string;
  pickup: { stopId: string; label: string; plannedAt: string };
  dropoff: { stopId: string; label: string; plannedAt: string };
  seats: number;
  unitPriceXof: number;
  subtotalXof: number;
  serviceFeeXof: number;
  discountXof: number;
  totalXof: number;
  seatsAvailable: number;
  acceptanceMode: 'AUTO' | 'MANUAL';
  acceptanceDeadline: string | null;
  holdMinutes: number;
  cashAllowed: boolean;
  cancellationPolicy: CancellationPolicy;
}

export interface Booking {
  id: string;
  reference: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: 'CASH' | null | string;
  seats: number;
  unitPriceXof: number;
  subtotalXof: number;
  serviceFeeXof: number;
  discountXof: number;
  totalXof: number;
  commissionXof?: number;
  driverNetXof?: number;
  holdExpiresAt: string | null;
  acceptanceDeadline: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  refundDueXof: number | null;
  freeCancellation: boolean;
  createdAt: string;
  isDemo: boolean;
  viewerRole: 'PASSENGER' | 'DRIVER';
  cancellationPolicy: CancellationPolicy;
  trip: {
    id: string;
    publicRef: string;
    status: string;
    departureAt: string;
    origin: string;
    destination: string;
    driver: { id: string; displayName: string | null };
    vehicle: { make: string; model: string; color: string; plateNumber: string | null };
  };
  passenger: { displayName: string | null; ratingAvg: number | null };
  pickup: { stopId: string; label: string; meetingPoint: string | null; plannedAt: string };
  dropoff: { stopId: string; label: string; meetingPoint: string | null; plannedAt: string };
  history: { from: BookingStatus | null; to: BookingStatus; at: string; by: 'PASSENGER' | 'DRIVER' | 'SYSTEM' | 'STAFF'; reason: string | null }[];
  actions: { canCancel: boolean; canAccept: boolean; canReject: boolean; canMarkNoShow: boolean; canPay: boolean };
}

export interface BookingSummary {
  id: string;
  reference: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  seats: number;
  totalXof: number;
  holdExpiresAt: string | null;
  acceptanceDeadline: string | null;
  isDemo: boolean;
  trip: { id: string; status: string; departureAt: string; driverName: string | null };
  pickup: { label: string; plannedAt: string };
  dropoff: { label: string; plannedAt: string };
}

export interface CancelPreview {
  refundXof: number;
  tripRefundXof: number;
  serviceFeeRefundXof: number;
  driverCompensationXof: number;
  refundPercent: number | null;
  basis: 'NOTHING_PAID' | 'CASH_NOT_COLLECTED' | 'FREE_CANCELLATION' | 'POLICY' | 'DRIVER_CANCELLED';
  lateDriver: boolean;
  paymentStatus: PaymentStatus;
  totalXof: number;
}

export interface Segment {
  tripId: string;
  pickupStopId: string;
  dropoffStopId: string;
  seats: number;
}

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING_ACCEPTANCE: 'En attente du conducteur',
  PENDING_PAYMENT: 'En attente de paiement',
  CONFIRMED: 'Confirmée',
  REJECTED: 'Refusée par le conducteur',
  EXPIRED: 'Expirée',
  CANCELLED_BY_PASSENGER: 'Annulée par vous',
  CANCELLED_BY_DRIVER: 'Annulée par le conducteur',
  CANCELLED_BY_ADMIN: 'Annulée par IvoireCovoit',
  NO_SHOW: 'Absence constatée',
  COMPLETED: 'Trajet effectué',
};

/** Libellé vu par le conducteur (le passager n'est pas « vous »). */
export function statusLabel(status: BookingStatus, role: 'PASSENGER' | 'DRIVER'): string {
  if (role === 'DRIVER' && status === 'CANCELLED_BY_PASSENGER') return 'Annulée par le passager';
  if (role === 'DRIVER' && status === 'CANCELLED_BY_DRIVER') return 'Annulée par vous';
  if (role === 'DRIVER' && status === 'PENDING_ACCEPTANCE') return 'Demande à traiter';
  return BOOKING_STATUS_LABEL[status];
}

export function statusTone(status: BookingStatus): 'success' | 'warning' | 'danger' | 'muted' {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return 'success';
  if (status === 'PENDING_ACCEPTANCE' || status === 'PENDING_PAYMENT') return 'warning';
  if (status === 'NO_SHOW' || status === 'REJECTED' || status.startsWith('CANCELLED')) return 'danger';
  return 'muted';
}

/** Texte expliquant le remboursement prévu, avant confirmation de l'annulation. */
export function refundText(p: Pick<CancelPreview, 'refundXof' | 'basis' | 'refundPercent' | 'driverCompensationXof' | 'lateDriver'>, formatXof: (n: number) => string): string {
  switch (p.basis) {
    case 'NOTHING_PAID':
      return 'Rien n’a été payé : l’annulation est gratuite et vos places sont libérées.';
    case 'CASH_NOT_COLLECTED':
      return 'Paiement en espèces non encore versé : rien ne vous sera demandé.';
    case 'FREE_CANCELLATION':
      return p.lateDriver
        ? `Le conducteur a plus de 30 min de retard : annulation sans frais, ${formatXof(p.refundXof)} vous seront remboursés.`
        : `Le trajet a été modifié : annulation sans frais, ${formatXof(p.refundXof)} vous seront remboursés.`;
    case 'DRIVER_CANCELLED':
      return `Le passager sera remboursé intégralement (${formatXof(p.refundXof)}).`;
    default:
      return p.refundXof > 0
        ? `Selon la politique d’annulation, ${formatXof(p.refundXof)} vous seront remboursés (${p.refundPercent} % de la part trajet).`
        : 'Selon la politique d’annulation, cette annulation n’ouvre droit à aucun remboursement.';
  }
}

const idem = (key: string) => ({ 'Idempotency-Key': key });

export const bookings = {
  quote: (s: Segment) => send<Quote>('/bff/api/bookings/quote', 'POST', s),
  create: (s: Segment & { paymentMethod?: 'CASH' }, key: string) =>
    send<Booking>('/bff/api/bookings', 'POST', { ...s, acceptCancellationPolicy: true }, idem(key)),
  mine: (scope: 'upcoming' | 'past', cursor?: string) =>
    send<{ data: BookingSummary[]; nextCursor: string | null }>(
      `/bff/api/bookings/mine?scope=${scope}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      'GET',
    ),
  get: (id: string) => send<Booking>(`/bff/api/bookings/${id}`, 'GET'),
  accept: (id: string) => send<Booking>(`/bff/api/bookings/${id}/accept`, 'POST', {}),
  reject: (id: string, reason?: string) => send<Booking>(`/bff/api/bookings/${id}/reject`, 'POST', reason ? { reason } : {}),
  cancelPreview: (id: string) => send<CancelPreview>(`/bff/api/bookings/${id}/cancel/preview`, 'POST', {}),
  cancel: (id: string, reason: string, key: string = newIdempotencyKey()) =>
    send<{ booking: Booking; refund: CancelPreview }>(`/bff/api/bookings/${id}/cancel`, 'POST', { reason }, idem(key)),
  noShow: (tripId: string, id: string) => send<Booking>(`/bff/api/trips/${tripId}/bookings/${id}/no-show`, 'POST', {}),
};
