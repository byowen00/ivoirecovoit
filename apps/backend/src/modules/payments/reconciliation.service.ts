import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { ReconciliationItemsTable } from '../../database/types';
import { PAYMENT_PROVIDER, type PaymentProvider, type ProviderTransaction } from './provider';

const DAY = 86_400_000;
/** Marge autour de la période : une opération créée à cheval sur minuit n'est pas signalée à tort. */
const MARGIN = 3_600_000;

type Issue = ReconciliationItemsTable['issue'];

/**
 * Rapprochement quotidien (doc 05 §9) : nos paiements et remboursements comparés aux opérations du prestataire
 * sur la même période. Chaque écart devient une ligne à examiner par l'équipe finance (écran admin, étape 9) ;
 * rien n'est corrigé automatiquement.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger('Rapprochement');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** Journée précédente (UTC, heure d'Abidjan), si elle n'a pas déjà été rapprochée. */
  async runDaily(now: Date = new Date()) {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = new Date(end.getTime() - DAY);
    const done = await this.db
      .selectFrom('reconciliation_runs')
      .select('id')
      .where('provider', '=', this.provider.code)
      .where('period_start', '=', start)
      .where('status', 'in', ['OK', 'DISCREPANCIES'])
      .executeTakeFirst();
    if (done) return null;
    return this.run(start, end);
  }

  async run(from: Date, to: Date) {
    const runId = uuidv7();
    await this.db
      .insertInto('reconciliation_runs')
      .values({ id: runId, provider: this.provider.code, period_start: from, period_end: to, status: 'RUNNING', internal_total_xof: null, provider_total_xof: null })
      .execute();
    if (!this.provider.listTransactions) {
      await this.db.updateTable('reconciliation_runs').set({ status: 'FAILED' }).where('id', '=', runId).execute();
      return { runId, status: 'FAILED' as const, items: 0 };
    }
    try {
      const wide = await this.provider.listTransactions(new Date(from.getTime() - MARGIN), new Date(to.getTime() + MARGIN));
      const inPeriod = await this.provider.listTransactions(from, to);
      const byMerchant = new Map(wide.map((t) => [`${t.kind}:${t.merchantReference}`, t]));

      const payments = await this.db
        .selectFrom('payments')
        .select(['id', 'provider_reference', 'amount_xof', 'status'])
        .where('provider', '=', this.provider.code)
        .where('created_at', '>=', from)
        .where('created_at', '<', to)
        .execute();
      const refunds = await this.db
        .selectFrom('refunds')
        .innerJoin('payments', 'payments.id', 'refunds.payment_id')
        .select(['refunds.id', 'refunds.payment_id', 'refunds.provider_reference', 'refunds.amount_xof', 'refunds.status'])
        .where('payments.provider', '=', this.provider.code)
        .where('refunds.created_at', '>=', from)
        .where('refunds.created_at', '<', to)
        .execute();
      const internalIds = new Set<string>();
      const items: { payment_id: string | null; provider_reference: string | null; issue: Issue; details: Record<string, unknown> }[] = [];

      const compare = (kind: 'PAYMENT' | 'REFUND', id: string, paymentId: string, amount: number, status: string, ref: string | null) => {
        internalIds.add(`${kind}:${id}`);
        const t = byMerchant.get(`${kind}:${id}`);
        const base = { kind, internalId: id, internalStatus: status, internalAmountXof: amount };
        // Une opération jamais arrivée chez le prestataire n'est un écart que si nous la croyons réussie.
        if (!t) {
          if (status === 'SUCCEEDED') items.push({ payment_id: paymentId, provider_reference: ref, issue: 'MISSING_PROVIDER', details: base });
          return;
        }
        if (t.amountXof !== amount) {
          items.push({ payment_id: paymentId, provider_reference: t.providerReference, issue: 'AMOUNT_MISMATCH', details: { ...base, providerAmountXof: t.amountXof } });
        }
        const internalOk = status === 'SUCCEEDED';
        const providerOk = t.status === 'SUCCEEDED';
        const stillOpen = ['CREATED', 'PENDING', 'REQUESTED', 'APPROVED', 'PROCESSING'].includes(status) && t.status === 'PENDING';
        if (internalOk !== providerOk && !stillOpen) {
          items.push({ payment_id: paymentId, provider_reference: t.providerReference, issue: 'STATUS_MISMATCH', details: { ...base, providerStatus: t.status } });
        }
      };
      for (const p of payments) compare('PAYMENT', p.id, p.id, p.amount_xof, p.status, p.provider_reference);
      for (const r of refunds) compare('REFUND', r.id, r.payment_id, r.amount_xof, r.status, r.provider_reference);

      const missingInternal = inPeriod.filter((t) => !internalIds.has(`${t.kind}:${t.merchantReference}`));
      if (missingInternal.length) {
        // Opération du prestataire hors de notre période (créée juste avant minuit chez nous) : vérifiée individuellement.
        const known = await this.knownIds(missingInternal);
        for (const t of missingInternal) {
          if (known.has(t.merchantReference)) continue;
          items.push({ payment_id: null, provider_reference: t.providerReference, issue: 'MISSING_INTERNAL', details: { kind: t.kind, merchantReference: t.merchantReference, providerAmountXof: t.amountXof, providerStatus: t.status } });
        }
      }

      const net = (succeededPayments: number, succeededRefunds: number) => succeededPayments - succeededRefunds;
      const sumOk = (rows: { amount_xof: number; status: string }[]) => rows.filter((r) => r.status === 'SUCCEEDED').reduce((s, r) => s + r.amount_xof, 0);
      const sumProvider = (kind: ProviderTransaction['kind']) => inPeriod.filter((t) => t.kind === kind && t.status === 'SUCCEEDED').reduce((s, t) => s + t.amountXof, 0);
      const internalTotal = net(sumOk(payments), sumOk(refunds));
      const providerTotal = net(sumProvider('PAYMENT'), sumProvider('REFUND'));

      await this.db.transaction().execute(async (trx) => {
        if (items.length) {
          await trx
            .insertInto('reconciliation_items')
            .values(items.map((i) => ({ id: uuidv7(), run_id: runId, payment_id: i.payment_id, provider_reference: i.provider_reference, issue: i.issue, details: JSON.stringify(i.details) })))
            .execute();
        }
        await trx
          .updateTable('reconciliation_runs')
          .set({ status: items.length ? 'DISCREPANCIES' : 'OK', internal_total_xof: internalTotal, provider_total_xof: providerTotal })
          .where('id', '=', runId)
          .execute();
      });
      if (items.length) this.logger.warn(`${items.length} écart(s) du ${from.toISOString()} au ${to.toISOString()}`);
      return { runId, status: items.length ? ('DISCREPANCIES' as const) : ('OK' as const), items: items.length, internalTotalXof: internalTotal, providerTotalXof: providerTotal };
    } catch (err) {
      this.logger.error(`Rapprochement impossible : ${(err as Error).message}`);
      await this.db.updateTable('reconciliation_runs').set({ status: 'FAILED' }).where('id', '=', runId).execute();
      return { runId, status: 'FAILED' as const, items: 0 };
    }
  }

  private async knownIds(ts: ProviderTransaction[]): Promise<Set<string>> {
    const uuid = /^[0-9a-f-]{36}$/i;
    const pay = ts.filter((t) => t.kind === 'PAYMENT' && uuid.test(t.merchantReference)).map((t) => t.merchantReference);
    const ref = ts.filter((t) => t.kind === 'REFUND' && uuid.test(t.merchantReference)).map((t) => t.merchantReference);
    const [a, b] = await Promise.all([
      pay.length ? this.db.selectFrom('payments').select('id').where('id', 'in', pay).execute() : [],
      ref.length ? this.db.selectFrom('refunds').select('id').where('id', 'in', ref).execute() : [],
    ]);
    return new Set([...a, ...b].map((r) => r.id));
  }
}
