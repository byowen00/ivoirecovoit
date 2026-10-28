import type { PaymentMethod } from '../../database/types';

/*
 * Couche de paiement interchangeable (doc 02 §5). Un prestataire (bac à sable interne, agrégateur réel plus tard)
 * implémente cette interface ; le reste du code ne connaît que des statuts normalisés.
 * Règle d'or : un paiement n'est réussi que sur un événement vérifié (webhook signé) ou une réponse
 * de getPaymentStatus obtenue par notre serveur, jamais sur le retour du navigateur ou de l'application.
 */

export type MobileMoneyMethod = Exclude<PaymentMethod, 'CASH'>;
export const MOBILE_MONEY_METHODS: readonly MobileMoneyMethod[] = ['WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY'];

export type ProviderPaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface NextAction {
  type: 'REDIRECT' | 'USSD_PUSH' | 'DEEPLINK';
  url?: string;
  instructions: string;
}

export interface InitiatePaymentInput {
  paymentId: string; // notre identifiant, transmis comme référence marchand
  amountXof: number;
  method: MobileMoneyMethod;
  payerPhone: string; // E.164 ; jamais de code secret
  description: string;
  idempotencyKey: string;
  returnUrl: string;
  notifyUrl: string;
}

export interface ProviderStatus {
  providerReference: string;
  merchantReference: string;
  status: ProviderPaymentStatus;
  amountXof: number;
  currency: string;
  occurredAt: Date;
  failureCode?: string;
}

export interface NormalizedPaymentEvent extends ProviderStatus {
  providerEventId: string;
  eventType: string;
}

export type WebhookVerification = { valid: true } | { valid: false; reason: 'MISSING_SIGNATURE' | 'BAD_SIGNATURE' | 'STALE_TIMESTAMP' };

export interface RefundResult {
  providerReference: string;
  status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  failureMessage?: string;
}

export interface ProviderTransaction {
  providerReference: string;
  merchantReference: string;
  kind: 'PAYMENT' | 'REFUND';
  amountXof: number;
  status: ProviderPaymentStatus;
}

export interface PaymentProvider {
  readonly code: string;
  readonly isSandbox: boolean;
  supportedMethods(): Promise<MobileMoneyMethod[]>;
  initiatePayment(input: InitiatePaymentInput): Promise<{ providerReference: string; nextAction: NextAction }>;
  getPaymentStatus(providerReference: string): Promise<ProviderStatus>;
  /** Recherche par notre référence, quand l'appel d'initialisation a échoué sans réponse (doc 05 §5.1). */
  findByMerchantReference?(paymentId: string): Promise<ProviderStatus | null>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, now?: Date): WebhookVerification;
  parseWebhook(rawBody: Buffer): NormalizedPaymentEvent;
  refund?(input: { refundId: string; providerReference: string; amountXof: number; reason: string; idempotencyKey: string }): Promise<RefundResult>;
  listTransactions?(from: Date, to: Date): Promise<ProviderTransaction[]>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export const METHOD_LABEL: Record<MobileMoneyMethod, string> = {
  WAVE: 'Wave',
  ORANGE_MONEY: 'Orange Money',
  MTN_MOMO: 'MTN MoMo',
  MOOV_MONEY: 'Moov Money',
};
