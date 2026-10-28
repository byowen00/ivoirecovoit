import { applicableRule, computeAmounts, driverCancellation, type FeeRule, passengerCancellation, type PolicyRules, promotionDiscount, type PromotionTerms } from './amounts';

const rule = (o: Partial<FeeRule> = {}): FeeRule => ({
  id: 'r',
  commission_bps: 1000,
  commission_fixed_xof: 0,
  commission_min_xof: 0,
  commission_max_xof: null,
  service_fee_bps: 600,
  service_fee_fixed_xof: 0,
  service_fee_min_xof: 0,
  service_fee_max_xof: null,
  ...o,
});

const STANDARD: PolicyRules = {
  passenger: [
    { minHoursBefore: 24, refundPercent: 100 },
    { minHoursBefore: 2, refundPercent: 50 },
    { minHoursBefore: 0, refundPercent: 0 },
  ],
  serviceFeeRefundableWithinMinutes: 15,
};

describe('Montants d’une réservation (doc 05 §8)', () => {
  it('exemple de démonstration : 5 000 FCFA, 1 place, frais 6 %, commission 10 %', () => {
    expect(computeAmounts(5000, 1, rule())).toEqual({
      unitPriceXof: 5000, seats: 1, subtotalXof: 5000, serviceFeeXof: 300, discountXof: 0, totalXof: 5300,
      commissionXof: 500, driverNetXof: 4500,
    });
  });

  it('frais arrondis au franc supérieur, commission au plus proche', () => {
    const a = computeAmounts(1050, 1, rule({ service_fee_bps: 333, commission_bps: 1050 }));
    expect(a.serviceFeeXof).toBe(35); // 34,965 -> 35
    expect(a.commissionXof).toBe(110); // 110,25 -> 110
    expect(computeAmounts(1050, 1, rule({ commission_bps: 1000 })).commissionXof).toBe(105);
  });

  it('montants fixes, minimum, maximum ; la commission ne dépasse jamais le sous-total', () => {
    expect(computeAmounts(500, 1, rule({ service_fee_min_xof: 100 })).serviceFeeXof).toBe(100);
    expect(computeAmounts(30000, 4, rule({ service_fee_max_xof: 2000 })).serviceFeeXof).toBe(2000);
    expect(computeAmounts(500, 1, rule({ commission_fixed_xof: 1000 })).commissionXof).toBe(500);
    const a = computeAmounts(3000, 3, rule());
    expect(a.subtotalXof).toBe(9000);
    expect(a.totalXof).toBe(a.subtotalXof + a.serviceFeeXof);
    expect(a.driverNetXof).toBe(a.subtotalXof - a.commissionXof);
  });

  it('refuse les montants non entiers', () => {
    expect(() => computeAmounts(10.5, 1, rule())).toThrow(RangeError);
    expect(() => computeAmounts(1000, 0, rule())).toThrow(RangeError);
  });
});

describe('Annulation (doc 05 §7)', () => {
  const amounts = { subtotalXof: 5000, serviceFeeXof: 300, totalXof: 5300, commissionXof: 500 };
  const dep = new Date('2026-11-10T08:00:00Z');
  const hoursBefore = (h: number) => new Date(dep.getTime() - h * 3_600_000);
  const base = { amounts, paymentStatus: 'PAID', departureAt: dep, confirmedAt: new Date('2026-11-01T08:00:00Z'), policy: STANDARD, freeCancellation: false };

  it('choix de la règle selon le délai, après le départ comprise', () => {
    expect(applicableRule(STANDARD.passenger, 30).refundPercent).toBe(100);
    expect(applicableRule(STANDARD.passenger, 24).refundPercent).toBe(100);
    expect(applicableRule(STANDARD.passenger, 10).refundPercent).toBe(50);
    expect(applicableRule(STANDARD.passenger, 1).refundPercent).toBe(0);
    expect(applicableRule(STANDARD.passenger, -3).refundPercent).toBe(0);
  });

  it('STANDARD : 100 %, 50 %, 0 % de la part trajet ; frais de service conservés', () => {
    const early = passengerCancellation({ ...base, now: hoursBefore(48) });
    expect(early).toMatchObject({ refundXof: 5000, tripRefundXof: 5000, serviceFeeRefundXof: 0, driverCompensationXof: 0, refundPercent: 100 });
    const mid = passengerCancellation({ ...base, now: hoursBefore(10) });
    // 2 500 conservés, commission au prorata 250 : 2 250 pour le conducteur
    expect(mid).toMatchObject({ refundXof: 2500, driverCompensationXof: 2250, refundPercent: 50 });
    const late = passengerCancellation({ ...base, now: hoursBefore(1) });
    expect(late).toMatchObject({ refundXof: 0, driverCompensationXof: 4500 });
  });

  it('frais de service rendus dans les 15 min après confirmation si le départ est à plus de 24 h', () => {
    const now = hoursBefore(48);
    const r = passengerCancellation({ ...base, confirmedAt: new Date(now.getTime() - 10 * 60_000), now });
    expect(r).toMatchObject({ refundXof: 5300, serviceFeeRefundXof: 300 });
    const tooLate = passengerCancellation({ ...base, confirmedAt: new Date(now.getTime() - 20 * 60_000), now });
    expect(tooLate.serviceFeeRefundXof).toBe(0);
  });

  it('annulation sans frais (horaire décalé ou retard du conducteur) : tout est rendu', () => {
    expect(passengerCancellation({ ...base, freeCancellation: true, now: hoursBefore(1) })).toMatchObject({ refundXof: 5300, driverCompensationXof: 0, reason: 'FREE_CANCELLATION' });
  });

  it('rien payé ou espèces non encore versées : aucun remboursement, rien dû', () => {
    expect(passengerCancellation({ ...base, paymentStatus: 'UNPAID', now: hoursBefore(1) })).toMatchObject({ refundXof: 0, driverCompensationXof: 0, reason: 'NOTHING_PAID' });
    expect(passengerCancellation({ ...base, paymentStatus: 'CASH_DUE', now: hoursBefore(1) }).reason).toBe('CASH_NOT_COLLECTED');
  });

  it('conducteur : remboursement intégral, frais de service compris', () => {
    expect(driverCancellation({ amounts, paymentStatus: 'PAID' })).toMatchObject({ refundXof: 5300, driverCompensationXof: 0 });
    expect(driverCancellation({ amounts, paymentStatus: 'UNPAID' }).refundXof).toBe(0);
  });
});

describe('Codes promo (doc 05 §8)', () => {
  const promo = (o: Partial<PromotionTerms>): PromotionTerms => ({ discount_type: 'FIXED', discount_value: 1000, max_discount_xof: null, ...o });

  it('réduction sur la part trajet seulement, plafonnée, jamais négative', () => {
    expect(promotionDiscount(5000, promo({}))).toBe(1000);
    expect(promotionDiscount(5000, promo({ discount_value: 9000 }))).toBe(5000);
    expect(promotionDiscount(5000, promo({ discount_type: 'PERCENT', discount_value: 1500 }))).toBe(750);
    expect(promotionDiscount(3333, promo({ discount_type: 'PERCENT', discount_value: 1000 }))).toBe(333);
    expect(promotionDiscount(5000, promo({ discount_type: 'PERCENT', discount_value: 5000, max_discount_xof: 1000 }))).toBe(1000);
  });

  it('frais de service et commission calculés sur le prix plein : le conducteur ne paie pas la promotion', () => {
    expect(computeAmounts(5000, 1, rule(), promo({}))).toEqual({
      unitPriceXof: 5000, seats: 1, subtotalXof: 5000, serviceFeeXof: 300, discountXof: 1000, totalXof: 4300, commissionXof: 500, driverNetXof: 4500,
    });
  });

  it('annulation à 50 % : remboursement sur ce qui a été payé, part du conducteur sur le prix plein', () => {
    const r = passengerCancellation({
      amounts: { subtotalXof: 5000, serviceFeeXof: 300, totalXof: 4300, commissionXof: 500, discountXof: 1000 },
      paymentStatus: 'PAID', departureAt: new Date('2026-11-02T08:00:00Z'), confirmedAt: null, now: new Date('2026-11-01T22:00:00Z'),
      policy: STANDARD, freeCancellation: false,
    });
    expect(r).toMatchObject({ refundXof: 2000, tripRefundXof: 2000, driverCompensationXof: 2250, refundPercent: 50 });
  });
});
