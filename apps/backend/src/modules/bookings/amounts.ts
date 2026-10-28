/*
 * Calcul des montants d'une réservation (doc 05 §8) et des conséquences d'une annulation (doc 05 §7).
 * Tout est en entiers XOF ; chaque arrondi est explicite. Les taux viennent de fee_rules (versionnées)
 * et des politiques d'annulation : ce sont des paramètres, pas des valeurs commerciales définitives.
 */

export interface FeeRule {
  id: string;
  commission_bps: number;
  commission_fixed_xof: number;
  commission_min_xof: number;
  commission_max_xof: number | null;
  service_fee_bps: number;
  service_fee_fixed_xof: number;
  service_fee_min_xof: number;
  service_fee_max_xof: number | null;
}

export interface BookingAmounts {
  unitPriceXof: number;
  seats: number;
  subtotalXof: number;
  serviceFeeXof: number;
  discountXof: number;
  totalXof: number;
  commissionXof: number;
  driverNetXof: number;
}

function clamp(v: number, min: number, max: number | null): number {
  return Math.min(Math.max(v, min), max ?? Number.POSITIVE_INFINITY);
}

/** ceil(a × bps / 10 000) en entiers. */
export function ceilBps(a: number, bps: number): number {
  return Math.floor((a * bps + 9999) / 10000);
}

/** Arrondi au plus proche, la moitié vers le haut : round_half_up(a × bps / 10 000). */
export function roundBps(a: number, bps: number): number {
  return Math.floor((a * bps + 5000) / 10000);
}

export interface PromotionTerms {
  discount_type: 'FIXED' | 'PERCENT';
  /** FIXED : montant en XOF ; PERCENT : points de base (1 000 = 10 %). */
  discount_value: number;
  max_discount_xof: number | null;
}

/**
 * Réduction d'un code promo (doc 05 §8), financée par la plateforme. Elle ne porte que sur la part trajet :
 * plafonnée au sous-total, jamais sur les frais de service. Pourcentage arrondi au franc inférieur.
 */
export function promotionDiscount(subtotalXof: number, p: PromotionTerms): number {
  const raw = p.discount_type === 'FIXED' ? p.discount_value : Math.floor((subtotalXof * p.discount_value) / 10000);
  return Math.max(0, Math.min(raw, p.max_discount_xof ?? Number.POSITIVE_INFINITY, subtotalXof));
}

export function computeAmounts(unitPriceXof: number, seats: number, rule: FeeRule, promotion?: PromotionTerms | null): BookingAmounts {
  if (!Number.isSafeInteger(unitPriceXof) || unitPriceXof < 0 || !Number.isInteger(seats) || seats < 1) {
    throw new RangeError('Montant ou nombre de places invalide');
  }
  const subtotalXof = unitPriceXof * seats;
  const serviceFeeXof = clamp(ceilBps(subtotalXof, rule.service_fee_bps) + rule.service_fee_fixed_xof, rule.service_fee_min_xof, rule.service_fee_max_xof);
  const commissionXof = Math.min(
    clamp(roundBps(subtotalXof, rule.commission_bps) + rule.commission_fixed_xof, rule.commission_min_xof, rule.commission_max_xof),
    subtotalXof,
  );
  const discountXof = promotion ? promotionDiscount(subtotalXof, promotion) : 0;
  return {
    unitPriceXof,
    seats,
    subtotalXof,
    serviceFeeXof,
    discountXof,
    totalXof: subtotalXof + serviceFeeXof - discountXof,
    commissionXof,
    driverNetXof: subtotalXof - commissionXof,
  };
}

// ------------------------------------------------------------------ annulation

export interface PolicyRules {
  passenger: { minHoursBefore: number; refundPercent: number }[];
  serviceFeeRefundableWithinMinutes?: number;
}

export interface CancellationOutcome {
  /** Montant à rendre au passager (part trajet + éventuels frais de service), jamais plus que ce qu'il a payé. */
  refundXof: number;
  tripRefundXof: number;
  serviceFeeRefundXof: number;
  /** Part trajet conservée revenant au conducteur, commission déduite au prorata. */
  driverCompensationXof: number;
  /** Pourcentage de la part trajet remboursé selon la politique (null si rien n'a été payé). */
  refundPercent: number | null;
  reason: 'NOTHING_PAID' | 'CASH_NOT_COLLECTED' | 'FREE_CANCELLATION' | 'POLICY' | 'DRIVER_CANCELLED';
}

interface CancelContext {
  amounts: Pick<BookingAmounts, 'subtotalXof' | 'serviceFeeXof' | 'totalXof' | 'commissionXof'> & { discountXof?: number };
  paymentStatus: string;
  departureAt: Date;
  confirmedAt: Date | null;
  now: Date;
}

const none = (reason: CancellationOutcome['reason']): CancellationOutcome => ({
  refundXof: 0,
  tripRefundXof: 0,
  serviceFeeRefundXof: 0,
  driverCompensationXof: 0,
  refundPercent: null,
  reason,
});

/** Règle applicable : la première dont le seuil est atteint ; en dessous du dernier seuil (ou après le départ), la dernière. */
export function applicableRule(rules: PolicyRules['passenger'], hoursBefore: number) {
  const sorted = [...rules].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  return sorted.find((r) => hoursBefore >= r.minHoursBefore) ?? sorted.at(-1)!;
}

/** Annulation par le passager (doc 05 §7.1). */
export function passengerCancellation(c: CancelContext & { policy: PolicyRules; freeCancellation: boolean }): CancellationOutcome {
  if (c.paymentStatus === 'CASH_DUE') return none('CASH_NOT_COLLECTED');
  if (c.paymentStatus !== 'PAID') return none('NOTHING_PAID');
  const { subtotalXof, serviceFeeXof, totalXof, commissionXof } = c.amounts;
  if (c.freeCancellation) {
    return { refundXof: totalXof, tripRefundXof: totalXof - serviceFeeXof, serviceFeeRefundXof: serviceFeeXof, driverCompensationXof: 0, refundPercent: 100, reason: 'FREE_CANCELLATION' };
  }
  const hoursBefore = (c.departureAt.getTime() - c.now.getTime()) / 3_600_000;
  const rule = applicableRule(c.policy.passenger, hoursBefore);
  // Le pourcentage s'applique à ce que le passager a réellement payé pour le trajet (réduction déduite) : une
  // réduction n'est jamais rendue en argent. Le conducteur, lui, garde sa part calculée sur le prix plein.
  const paidTripXof = subtotalXof - (c.amounts.discountXof ?? 0);
  const tripRefundXof = Math.floor((paidTripXof * rule.refundPercent) / 100);
  const keptGross = subtotalXof - Math.floor((subtotalXof * rule.refundPercent) / 100);
  const window = c.policy.serviceFeeRefundableWithinMinutes ?? 0;
  const withinWindow =
    c.confirmedAt !== null && c.now.getTime() - c.confirmedAt.getTime() <= window * 60_000 && hoursBefore > 24;
  const serviceFeeRefundXof = withinWindow ? serviceFeeXof : 0;
  const commissionOnKept = subtotalXof > 0 ? Math.round((commissionXof * keptGross) / subtotalXof) : 0;
  return {
    refundXof: Math.min(totalXof, tripRefundXof + serviceFeeRefundXof),
    tripRefundXof,
    serviceFeeRefundXof,
    driverCompensationXof: keptGross - commissionOnKept,
    refundPercent: rule.refundPercent,
    reason: 'POLICY',
  };
}

/** Annulation par le conducteur (doc 05 §7.2) : remboursement intégral, rien n'est dû au conducteur. */
export function driverCancellation(c: Pick<CancelContext, 'amounts' | 'paymentStatus'>): CancellationOutcome {
  if (c.paymentStatus !== 'PAID') return none(c.paymentStatus === 'CASH_DUE' ? 'CASH_NOT_COLLECTED' : 'NOTHING_PAID');
  const { serviceFeeXof, totalXof } = c.amounts;
  return { refundXof: totalXof, tripRefundXof: totalXof - serviceFeeXof, serviceFeeRefundXof: serviceFeeXof, driverCompensationXof: 0, refundPercent: 100, reason: 'DRIVER_CANCELLED' };
}
