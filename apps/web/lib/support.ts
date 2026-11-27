import { send } from './account';

export type SupportTopic = 'COMPTE' | 'RESERVATION' | 'PAIEMENT' | 'CONDUCTEUR' | 'SECURITE' | 'AUTRE';
export type SupportStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';

export const TOPIC_LABEL: Record<SupportTopic, string> = {
  COMPTE: 'Mon compte',
  RESERVATION: 'Une réservation',
  PAIEMENT: 'Paiement ou remboursement',
  CONDUCTEUR: 'Espace conducteur',
  SECURITE: 'Sécurité',
  AUTRE: 'Autre question',
};
export const STATUS_LABEL: Record<SupportStatus, string> = { OPEN: 'En attente de l’équipe', ANSWERED: 'Répondu', CLOSED: 'Clôturé' };

export interface SupportSummary {
  id: string;
  reference: string;
  subject: string;
  topic: SupportTopic;
  status: SupportStatus;
  lastMessageAt: string;
  createdAt: string;
}
export interface SupportTicket extends SupportSummary {
  user?: { id: string; displayName: string | null };
  messages: { id: string; body: string; fromStaff: boolean; author: string; createdAt: string }[];
}

export const support = {
  mine: () => send<{ data: SupportSummary[] }>('/bff/api/support/tickets', 'GET'),
  open: (input: { subject: string; topic: SupportTopic; body: string }) => send<SupportTicket>('/bff/api/support/tickets', 'POST', input),
  get: (id: string) => send<SupportTicket>(`/bff/api/support/tickets/${id}`, 'GET'),
  reply: (id: string, body: string) => send<SupportTicket>(`/bff/api/support/tickets/${id}/messages`, 'POST', { body }),
};
