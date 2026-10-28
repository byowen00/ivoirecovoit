import { send } from './account';
import { apiGet } from './api';
import { newIdempotencyKey } from './trips';

// ------------------------------------------------------------------ notifications (écran 13)

export type NotificationCategory = 'TRANSACTIONAL' | 'REMINDERS' | 'MESSAGES' | 'REVIEWS';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  category: NotificationCategory;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  pushAvailable: boolean;
  categories: { code: NotificationCategory; label: string; mandatory: boolean; enabled: boolean }[];
}

// ------------------------------------------------------------------ messagerie

export interface ChatMessage {
  id: string;
  mine: boolean;
  body: string;
  wasRedacted: boolean;
  hidden: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface Conversation {
  bookingId: string;
  reference: string;
  viewerRole: 'PASSENGER' | 'DRIVER';
  other: { firstName: string | null; role: 'PASSENGER' | 'DRIVER' };
  canSend: boolean;
  closedReason: string | null;
  contactsMasked: boolean;
  data: ChatMessage[];
}

// ------------------------------------------------------------------ avis

export interface ReviewStatus {
  canReview: boolean;
  deadline: string | null;
  subjectRole: 'PASSENGER' | 'DRIVER';
  mine: { rating: number; comment: string | null; published: boolean; createdAt: string } | null;
}

export interface PublicReviews {
  user: {
    id: string;
    firstName: string | null;
    asDriver: { ratingAvg: number | null; ratingCount: number };
    asPassenger: { ratingAvg: number | null; ratingCount: number };
  };
  data: { id: string; rating: number; comment: string | null; authorFirstName: string | null; aboutRole: 'PASSENGER' | 'DRIVER'; publishedAt: string }[];
  nextCursor: string | null;
}

// ------------------------------------------------------------------ signalements

export type ReportCategory = 'DANGEROUS_DRIVING' | 'HARASSMENT' | 'FRAUD' | 'NO_SHOW' | 'INAPPROPRIATE' | 'OTHER';
export type ReportTarget = 'USER' | 'TRIP' | 'MESSAGE' | 'REVIEW' | 'VEHICLE';

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  DANGEROUS_DRIVING: 'Conduite dangereuse',
  HARASSMENT: 'Harcèlement ou menace',
  FRAUD: 'Fraude ou arnaque',
  NO_SHOW: 'Absence au rendez-vous',
  INAPPROPRIATE: 'Contenu ou comportement inapproprié',
  OTHER: 'Autre',
};

export const REPORT_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Reçu',
  IN_REVIEW: 'En cours d’examen',
  ACTION_TAKEN: 'Traité, mesure prise',
  DISMISSED: 'Classé sans suite',
};

export interface MyReport {
  id: string;
  targetType: ReportTarget;
  category: ReportCategory;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ réclamations (écran 16)

export type DisputeStatus = 'OPEN' | 'AWAITING_RESPONSE' | 'IN_REVIEW' | 'RESOLVED' | 'REJECTED' | 'CLOSED';

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  OPEN: 'Ouverte',
  AWAITING_RESPONSE: 'En attente de la réponse de l’autre partie',
  IN_REVIEW: 'En cours d’examen par le support',
  RESOLVED: 'Décision rendue',
  REJECTED: 'Rejetée',
  CLOSED: 'Close',
};

export const DISPUTE_DECISION_LABEL: Record<string, string> = {
  NO_REFUND: 'Pas de remboursement',
  PARTIAL_REFUND: 'Remboursement partiel',
  FULL_REFUND: 'Remboursement intégral',
  DRIVER_PENALTY: 'Mesure envers le conducteur',
};

export interface DisputeSummary {
  id: string;
  reference: string;
  status: DisputeStatus;
  reasonCode: string;
  reasonLabel: string;
  openedByMe: boolean;
  bookingId: string;
  bookingReference: string;
  createdAt: string;
}

export interface Dispute {
  id: string;
  reference: string;
  bookingId: string;
  bookingReference: string;
  route: string;
  departureAt: string;
  reasonCode: string;
  reasonLabel: string;
  description: string;
  status: DisputeStatus;
  openedByMe: boolean;
  responseDeadline: string | null;
  decision: string | null;
  decisionNote: string | null;
  decidedRefundXof: number | null;
  resolvedAt: string | null;
  createdAt: string;
  canReply: boolean;
  messages: { id: string; from: 'ME' | 'PASSENGER' | 'DRIVER' | 'SUPPORT'; body: string; createdAt: string }[];
}

export interface DisputeEligibility {
  allowed: boolean;
  deadline: string;
  openDisputeId: string | null;
  reasons: { code: string; label: string }[];
}

// ------------------------------------------------------------------ sécurité

export interface EmergencyNumbers {
  validated: boolean;
  notice: string | null;
  numbers: { label: string; phone: string }[];
}

export interface ShareLink {
  url: string;
  token: string;
  expiresAt: string;
}

export interface SharedTrip {
  status: string;
  statusText: string;
  pickup: { label: string; plannedAt: string };
  dropoff: { label: string; plannedAt: string };
  departureAt: string;
  estimatedArrivalAt: string;
  startedAt: string | null;
  completedAt: string | null;
  isEstimate: true;
  driver: { firstName: string | null };
  vehicle: { make: string; model: string; color: string; plateNumber: string | null };
  expiresAt: string;
  isDemo: boolean;
}

const idem = () => ({ 'Idempotency-Key': newIdempotencyKey() });

export const notifications = {
  list: (cursor?: string, unread = false) =>
    send<{ data: AppNotification[]; nextCursor: string | null; unreadCount: number }>(
      `/bff/api/notifications?limit=30${cursor ? `&cursor=${cursor}` : ''}${unread ? '&unread=true' : ''}`,
      'GET',
    ),
  unreadCount: () => send<{ unreadCount: number }>('/bff/api/notifications/unread-count', 'GET'),
  markRead: (ids: string[]) => send<{ updated: number }>('/bff/api/notifications/read', 'POST', { ids }),
  markAllRead: () => send<{ updated: number }>('/bff/api/notifications/read', 'POST', { all: true }),
  preferences: () => send<NotificationPreferences>('/bff/api/me/notification-preferences', 'GET'),
  setPreferences: (patch: Partial<Record<Exclude<NotificationCategory, 'TRANSACTIONAL'>, boolean>>) =>
    send<NotificationPreferences>('/bff/api/me/notification-preferences', 'PUT', patch),
};

export const trust = {
  conversation: (bookingId: string) => send<Conversation>(`/bff/api/bookings/${bookingId}/messages`, 'GET'),
  sendMessage: (bookingId: string, body: string) => send<ChatMessage>(`/bff/api/bookings/${bookingId}/messages`, 'POST', { body }),
  reviewStatus: (bookingId: string) => send<ReviewStatus>(`/bff/api/bookings/${bookingId}/review`, 'GET'),
  review: (bookingId: string, rating: number, comment?: string) =>
    send<ReviewStatus>(`/bff/api/bookings/${bookingId}/reviews`, 'POST', comment ? { rating, comment } : { rating }),
  publicReviews: (userId: string) => apiGet<PublicReviews>(`/users/${userId}/reviews`),
  report: (input: { targetType: ReportTarget; targetId: string; bookingId?: string; category: ReportCategory; description: string }) =>
    send<{ id: string }>('/bff/api/reports', 'POST', input, idem()),
  myReports: () => send<{ data: MyReport[] }>('/bff/api/reports/mine', 'GET'),
  disputeEligibility: (bookingId: string) => send<DisputeEligibility>(`/bff/api/bookings/${bookingId}/dispute`, 'GET'),
  openDispute: (input: { bookingId: string; reasonCode: string; description: string }) => send<Dispute>('/bff/api/disputes', 'POST', input, idem()),
  myDisputes: () => send<{ data: DisputeSummary[] }>('/bff/api/disputes/mine', 'GET'),
  dispute: (id: string) => send<Dispute>(`/bff/api/disputes/${id}`, 'GET'),
  replyDispute: (id: string, body: string) => send<Dispute>(`/bff/api/disputes/${id}/messages`, 'POST', { body }),
  emergencyNumbers: () => apiGet<EmergencyNumbers>('/safety/emergency-numbers'),
  shareStatus: (bookingId: string) => send<{ active: boolean; expiresAt: string | null; createdAt: string | null }>(`/bff/api/bookings/${bookingId}/share`, 'GET'),
  createShare: (bookingId: string) => send<ShareLink>(`/bff/api/bookings/${bookingId}/share`, 'POST', {}),
  revokeShare: (bookingId: string) => send<void>(`/bff/api/bookings/${bookingId}/share`, 'DELETE'),
  sharedTrip: (token: string) => apiGet<SharedTrip>(`/share/${encodeURIComponent(token)}`, { retries: 1 }),
};

/** Texte prêt à envoyer par SMS ou WhatsApp au contact d'urgence. */
export function shareMessage(url: string, route: string): string {
  return `Je voyage avec IvoireCovoit (${route}). Suivez mon trajet ici : ${url} (horaires estimés, pas de position GPS).`;
}
