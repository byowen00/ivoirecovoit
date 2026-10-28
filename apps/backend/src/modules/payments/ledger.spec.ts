import { paymentLines, refundLines, refundSplit } from './ledger';

const demo = { subtotalXof: 5000, serviceFeeXof: 300, discountXof: 0, totalXof: 5300, commissionXof: 500, driverNetXof: 4500 };
const sum = (lines: { amountXof: number }[]) => lines.reduce((s, l) => s + l.amountXof, 0);

describe('grand livre (doc 05 §9)', () => {
  it('paiement réussi : journal équilibré, conducteur crédité de son net', () => {
    const lines = paymentLines(demo);
    expect(sum(lines)).toBe(0);
    expect(lines.find((l) => l.account === 'DRIVER_PAYABLE')?.amountXof).toBe(-4500);
    expect(lines.find((l) => l.account === 'PROVIDER_CLEARING')?.amountXof).toBe(5300);
  });

  it('annulation par le conducteur : tout est rendu, conducteur et plateforme à zéro', () => {
    const split = refundSplit(demo, 5300, 300, 0);
    expect(split).toEqual({ driverXof: 4500, commissionXof: 500, feesXof: 300, promoXof: 0 });
    const net = [...paymentLines(demo), ...refundLines(split, 5300)];
    expect(sum(net)).toBe(0);
    for (const account of ['DRIVER_PAYABLE', 'PLATFORM_REVENUE_COMMISSION', 'PLATFORM_REVENUE_FEES', 'PROVIDER_CLEARING']) {
      expect(sum(net.filter((l) => l.account === account))).toBe(0);
    }
  });

  it('annulation passager à 50 % : la plateforme garde les frais et la commission au prorata', () => {
    // Part trajet 5 000 : 2 500 rendus ; part conservée 2 500, commission au prorata 250, conducteur 2 250.
    const split = refundSplit(demo, 2500, 0, 2250);
    expect(split).toEqual({ driverXof: 2250, commissionXof: 250, feesXof: 0, promoXof: 0 });
    const net = [...paymentLines(demo), ...refundLines(split, 2500)];
    expect(sum(net.filter((l) => l.account === 'DRIVER_PAYABLE'))).toBe(-2250);
    expect(sum(net.filter((l) => l.account === 'PLATFORM_REVENUE_COMMISSION'))).toBe(-250);
    expect(sum(net.filter((l) => l.account === 'PLATFORM_REVENUE_FEES'))).toBe(-300);
  });

  it('remboursement intégral avec réduction : la réduction est annulée, tous les comptes reviennent à zéro', () => {
    const promo = { ...demo, discountXof: 1000, totalXof: 4300 };
    const split = refundSplit(promo, 4300, 300, 0);
    const net = [...paymentLines(promo), ...refundLines(split, 4300)];
    for (const account of ['DRIVER_PAYABLE', 'PLATFORM_REVENUE_COMMISSION', 'PLATFORM_REVENUE_FEES', 'PROMO_EXPENSE', 'PROVIDER_CLEARING']) {
      expect(sum(net.filter((l) => l.account === account))).toBe(0);
    }
    expect(() => refundSplit(promo, 2000, 0, 2250)).toThrow();
  });

  it('refuse une ventilation incohérente', () => {
    expect(() => refundSplit(demo, 6000, 300, 0)).toThrow();
    expect(() => refundSplit(demo, 5300, 400, 0)).toThrow();
  });
});
