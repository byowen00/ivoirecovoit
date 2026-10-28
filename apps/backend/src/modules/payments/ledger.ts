import type { Transaction } from 'kysely';
import { uuidv7 } from '../../common/ids';
import type { Database } from '../../database/types';

/*
 * Grand livre en partie double (doc 05 §9) : débit > 0, crédit < 0, chaque journal s'équilibre à zéro
 * (contrôlé par un trigger différé en base). Le solde de DRIVER_PAYABLE, ventilé par réservation, est ce qui est dû
 * aux conducteurs ; PASSENGER_REFUNDS_PAYABLE porte les paiements reçus sans réservation à honorer (paiement tardif).
 */
export const ACCOUNTS = {
  clearing: 'PROVIDER_CLEARING',
  driverPayable: 'DRIVER_PAYABLE',
  commission: 'PLATFORM_REVENUE_COMMISSION',
  fees: 'PLATFORM_REVENUE_FEES',
  promo: 'PROMO_EXPENSE',
  passengerRefunds: 'PASSENGER_REFUNDS_PAYABLE',
} as const;

export interface LedgerLine {
  account: string;
  amountXof: number;
}

interface LedgerRefs {
  bookingId: string;
  paymentId?: string | null;
  refundId?: string | null;
  description: string;
}

/** Écrit un journal équilibré ; les lignes nulles sont omises. Renvoie l'identifiant du journal. */
export async function postJournal(trx: Transaction<Database>, lines: LedgerLine[], refs: LedgerRefs): Promise<string> {
  const kept = lines.filter((l) => l.amountXof !== 0);
  const balance = kept.reduce((s, l) => s + l.amountXof, 0);
  if (balance !== 0) throw new Error(`Journal déséquilibré (${balance} XOF) : ${refs.description}`);
  const journalId = uuidv7();
  if (kept.length === 0) return journalId;
  await trx
    .insertInto('ledger_entries')
    .values(
      kept.map((l) => ({
        journal_id: journalId,
        account: l.account,
        amount_xof: l.amountXof,
        booking_id: refs.bookingId,
        payment_id: refs.paymentId ?? null,
        refund_id: refs.refundId ?? null,
        description: refs.description,
      })),
    )
    .execute();
  return journalId;
}

export interface BookingMoney {
  subtotalXof: number;
  serviceFeeXof: number;
  discountXof: number;
  totalXof: number;
  commissionXof: number;
  driverNetXof: number;
}

/** Paiement réussi d'une réservation confirmée (doc 05 §9, première ligne). */
export function paymentLines(m: BookingMoney): LedgerLine[] {
  return [
    { account: ACCOUNTS.clearing, amountXof: m.totalXof },
    { account: ACCOUNTS.promo, amountXof: m.discountXof },
    { account: ACCOUNTS.driverPayable, amountXof: -m.driverNetXof },
    { account: ACCOUNTS.commission, amountXof: -m.commissionXof },
    { account: ACCOUNTS.fees, amountXof: -m.serviceFeeXof },
  ];
}

/** Paiement reçu alors que la réservation ne peut plus être honorée : à rembourser intégralement (doc 05 §5.4). */
export function unallocatedPaymentLines(amountXof: number): LedgerLine[] {
  return [
    { account: ACCOUNTS.clearing, amountXof },
    { account: ACCOUNTS.passengerRefunds, amountXof: -amountXof },
  ];
}

export interface RefundSplit {
  driverXof: number;
  commissionXof: number;
  feesXof: number;
  promoXof: number;
}

/**
 * Ventilation d'un remboursement entre la part du conducteur, la commission, les frais de service et la réduction,
 * d'après ce qui a été figé à l'annulation : remboursement total, frais rendus et part laissée au conducteur.
 * Conducteur : il garde `compensation` au lieu de `driver_net`. Commission : la plateforme garde la commission
 * au prorata de la part trajet conservée. Frais : ceux qui sont rendus. Réduction (code promo) : la plateforme
 * récupère la part de réduction correspondant à ce qui n'est plus dû au conducteur ; tout rembourser l'annule.
 */
export function refundSplit(m: BookingMoney, refundXof: number, serviceFeeRefundXof: number, compensationXof: number): RefundSplit {
  const driverXof = m.driverNetXof - compensationXof;
  const tripRefund = refundXof - serviceFeeRefundXof;
  let commissionXof: number;
  let promoXof: number;
  if (m.discountXof === 0) {
    commissionXof = tripRefund - driverXof;
    promoXof = 0;
  } else if (refundXof === m.totalXof) {
    commissionXof = m.commissionXof;
    promoXof = m.discountXof;
  } else {
    // Le conducteur garde la même fraction de son net que la plateforme de sa commission.
    commissionXof = m.driverNetXof > 0 ? m.commissionXof - Math.round((m.commissionXof * compensationXof) / m.driverNetXof) : m.commissionXof;
    promoXof = Math.min(Math.max(driverXof + commissionXof - tripRefund, 0), m.discountXof);
    commissionXof = tripRefund + promoXof - driverXof; // équilibre exact après arrondis
  }
  if (tripRefund < 0 || driverXof < 0 || commissionXof < 0 || commissionXof > m.commissionXof || serviceFeeRefundXof > m.serviceFeeXof || promoXof > m.discountXof) {
    throw new Error(`Ventilation de remboursement incohérente (remboursement ${refundXof}, frais ${serviceFeeRefundXof}, part conducteur ${compensationXof})`);
  }
  return { driverXof, commissionXof, feesXof: serviceFeeRefundXof, promoXof };
}

export function refundLines(split: RefundSplit, refundXof: number): LedgerLine[] {
  return [
    { account: ACCOUNTS.driverPayable, amountXof: split.driverXof },
    { account: ACCOUNTS.commission, amountXof: split.commissionXof },
    { account: ACCOUNTS.fees, amountXof: split.feesXof },
    { account: ACCOUNTS.promo, amountXof: -split.promoXof },
    { account: ACCOUNTS.clearing, amountXof: -refundXof },
  ];
}

export function unallocatedRefundLines(refundXof: number): LedgerLine[] {
  return [
    { account: ACCOUNTS.passengerRefunds, amountXof: refundXof },
    { account: ACCOUNTS.clearing, amountXof: -refundXof },
  ];
}
