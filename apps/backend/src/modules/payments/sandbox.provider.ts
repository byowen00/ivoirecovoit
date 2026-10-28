import { HttpStatus } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { maskPhone } from '../../common/phone';
import type { Db } from '../../database/database.module';
import type {
  InitiatePaymentInput,
  MobileMoneyMethod,
  NormalizedPaymentEvent,
  PaymentProvider,
  ProviderPaymentStatus,
  ProviderStatus,
  ProviderTransaction,
  RefundResult,
  WebhookVerification,
} from './provider';
import { MOBILE_MONEY_METHODS } from './provider';

export const SANDBOX_SIGNATURE_HEADER = 'x-sandbox-signature';
/** Fenêtre de validité de l'horodatage d'un webhook (doc 02 §6). */
const WEBHOOK_TOLERANCE_S = 300;

const eventSchema = z.object({
  id: z.string().min(8).max(150),
  type: z.enum(['payment.updated', 'refund.updated']),
  data: z.object({
    reference: z.string().min(1).max(40),
    merchantReference: z.string().max(40),
    status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED']),
    amount: z.number().int(),
    currency: z.string().length(3),
    occurredAt: z.iso.datetime(),
    failureCode: z.string().max(50).optional(),
  }),
});

const header = (headers: Record<string, string | string[] | undefined>, name: string): string | undefined => {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Bac à sable interne : simule un agrégateur de Mobile Money, sans aucun argent réel.
 * Les opérations sont gardées dans `sandbox_transactions` ; les webhooks sont signés en HMAC-SHA256
 * (`t=<horodatage>,v1=<signature de "t.corps">`) avec SANDBOX_WEBHOOK_SECRET, comme le ferait un vrai prestataire.
 * La décision (valider, refuser, laisser expirer) se prend sur la page de paiement simulée (/sandbox/pay/:ref).
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly code = 'sandbox';
  readonly isSandbox = true;

  constructor(
    private readonly db: Db,
    private readonly secret: string,
    private readonly apiBaseUrl: string,
  ) {}

  async supportedMethods(): Promise<MobileMoneyMethod[]> {
    return [...MOBILE_MONEY_METHODS];
  }

  async initiatePayment(input: InitiatePaymentInput) {
    // Même clé d'idempotence : même opération (un prestataire réel ferait de même).
    const existing = await this.db
      .selectFrom('sandbox_transactions')
      .select('provider_reference')
      .where('merchant_reference', '=', input.paymentId)
      .where('kind', '=', 'PAYMENT')
      .executeTakeFirst();
    const providerReference = existing?.provider_reference ?? `SBX-${randomBytes(9).toString('base64url')}`;
    if (!existing) {
      await this.db
        .insertInto('sandbox_transactions')
        .values({
          provider_reference: providerReference,
          kind: 'PAYMENT',
          merchant_reference: input.paymentId,
          amount_xof: input.amountXof,
          method: input.method,
          payer_phone_masked: maskPhone(input.payerPhone),
          status: 'PENDING',
        })
        .execute();
    }
    return {
      providerReference,
      nextAction: {
        type: 'REDIRECT' as const,
        url: `${this.apiBaseUrl}/api/v1/sandbox/pay/${providerReference}`,
        instructions:
          'Bac à sable : aucun argent réel. Ouvrez la page de paiement simulée pour valider, refuser ou laisser expirer le paiement.',
      },
    };
  }

  private async row(providerReference: string) {
    return this.db.selectFrom('sandbox_transactions').selectAll().where('provider_reference', '=', providerReference).executeTakeFirst();
  }

  private toStatus(r: NonNullable<Awaited<ReturnType<SandboxPaymentProvider['row']>>>): ProviderStatus {
    return {
      providerReference: r.provider_reference,
      merchantReference: r.merchant_reference,
      status: r.status,
      amountXof: Number(r.amount_xof),
      currency: 'XOF',
      occurredAt: r.updated_at,
    };
  }

  async getPaymentStatus(providerReference: string): Promise<ProviderStatus> {
    const r = await this.row(providerReference);
    if (!r) throw new ApiError(HttpStatus.BAD_GATEWAY, 'PROVIDER_UNKNOWN_REFERENCE', 'Paiement inconnu du prestataire.');
    return this.toStatus(r);
  }

  async findByMerchantReference(paymentId: string): Promise<ProviderStatus | null> {
    const r = await this.db
      .selectFrom('sandbox_transactions')
      .selectAll()
      .where('merchant_reference', '=', paymentId)
      .where('kind', '=', 'PAYMENT')
      .executeTakeFirst();
    return r ? this.toStatus(r) : null;
  }

  /** Change l'état d'une opération simulée (décision prise sur la page de paiement du bac à sable). */
  async settle(providerReference: string, status: Exclude<ProviderPaymentStatus, 'PENDING'>): Promise<ProviderStatus | null> {
    const r = await this.db
      .updateTable('sandbox_transactions')
      .set({ status })
      .where('provider_reference', '=', providerReference)
      .where('status', '=', 'PENDING')
      .returningAll()
      .executeTakeFirst();
    return r ? this.toStatus(r) : null;
  }

  async transaction(providerReference: string) {
    return this.row(providerReference);
  }

  /** Corps et en-têtes d'un webhook signé, tel que le bac à sable l'envoie. */
  buildWebhook(
    s: Pick<ProviderStatus, 'providerReference' | 'merchantReference' | 'status' | 'amountXof'> & { failureCode?: string },
    opts: { occurredAt?: Date; eventId?: string; signedAt?: Date; kind?: 'PAYMENT' | 'REFUND' } = {},
  ): { rawBody: Buffer; headers: Record<string, string> } {
    const body = {
      id: opts.eventId ?? `evt_${uuidv7()}`,
      type: opts.kind === 'REFUND' ? 'refund.updated' : 'payment.updated',
      data: {
        reference: s.providerReference,
        merchantReference: s.merchantReference,
        status: s.status,
        amount: s.amountXof,
        currency: 'XOF',
        occurredAt: (opts.occurredAt ?? new Date()).toISOString(),
        ...(s.failureCode ? { failureCode: s.failureCode } : {}),
      },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const t = Math.floor((opts.signedAt ?? new Date()).getTime() / 1000);
    return { rawBody, headers: { 'content-type': 'application/json', [SANDBOX_SIGNATURE_HEADER]: this.sign(rawBody, t) } };
  }

  sign(rawBody: Buffer, t: number): string {
    const v1 = createHmac('sha256', this.secret).update(`${t}.`).update(rawBody).digest('hex');
    return `t=${t},v1=${v1}`;
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, now: Date = new Date()): WebhookVerification {
    const value = header(headers, SANDBOX_SIGNATURE_HEADER);
    if (!value) return { valid: false, reason: 'MISSING_SIGNATURE' };
    const parts = Object.fromEntries(value.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
    const t = Number(parts.t);
    if (!Number.isInteger(t) || !parts.v1 || !/^[0-9a-f]{64}$/.test(parts.v1)) return { valid: false, reason: 'BAD_SIGNATURE' };
    const expected = Buffer.from(this.sign(rawBody, t).split('v1=')[1]!, 'hex');
    if (!timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'))) return { valid: false, reason: 'BAD_SIGNATURE' };
    if (Math.abs(now.getTime() / 1000 - t) > WEBHOOK_TOLERANCE_S) return { valid: false, reason: 'STALE_TIMESTAMP' };
    return { valid: true };
  }

  parseWebhook(rawBody: Buffer): NormalizedPaymentEvent {
    const e = eventSchema.parse(JSON.parse(rawBody.toString('utf8')));
    return {
      providerEventId: e.id,
      eventType: e.type,
      providerReference: e.data.reference,
      merchantReference: e.data.merchantReference,
      status: e.data.status,
      amountXof: e.data.amount,
      currency: e.data.currency,
      occurredAt: new Date(e.data.occurredAt),
      failureCode: e.data.failureCode,
    };
  }

  /** Remboursement simulé : accepté immédiatement par le « prestataire ». */
  async refund(input: { refundId: string; providerReference: string; amountXof: number; idempotencyKey: string }): Promise<RefundResult> {
    const existing = await this.db
      .selectFrom('sandbox_transactions')
      .select(['provider_reference', 'status'])
      .where('merchant_reference', '=', input.refundId)
      .where('kind', '=', 'REFUND')
      .executeTakeFirst();
    if (existing) return { providerReference: existing.provider_reference, status: existing.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED' };
    const payment = await this.row(input.providerReference);
    if (!payment || payment.status !== 'SUCCEEDED') {
      return { providerReference: '', status: 'FAILED', failureMessage: 'Paiement d’origine introuvable ou non réussi chez le prestataire.' };
    }
    const providerReference = `SBR-${randomBytes(9).toString('base64url')}`;
    await this.db
      .insertInto('sandbox_transactions')
      .values({
        provider_reference: providerReference,
        kind: 'REFUND',
        merchant_reference: input.refundId,
        amount_xof: input.amountXof,
        method: payment.method,
        payer_phone_masked: payment.payer_phone_masked,
        status: 'SUCCEEDED',
      })
      .execute();
    return { providerReference, status: 'SUCCEEDED' };
  }

  async listTransactions(from: Date, to: Date): Promise<ProviderTransaction[]> {
    const rows = await this.db
      .selectFrom('sandbox_transactions')
      .selectAll()
      .where('created_at', '>=', from)
      .where('created_at', '<', to)
      .execute();
    return rows.map((r) => ({
      providerReference: r.provider_reference,
      merchantReference: r.merchant_reference,
      kind: r.kind,
      amountXof: Number(r.amount_xof),
      status: r.status,
    }));
  }
}
