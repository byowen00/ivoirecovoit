import { DEFAULT_DYNAMIC_PRICING as D, dynamicPricingSchema, priceFactors, resolveDynamicPricing } from './price-factors';

const at = (iso: string) => new Date(iso);
const now = at('2026-12-01T00:00:00Z');

describe('tarif dynamique', () => {
  it('pluie, heure de pointe et nuit, avec plafond cumulé', () => {
    // Mardi 07:30 sous la pluie : +10 pluie, +10 pointe.
    const r = priceFactors(D, { kind: 'URBAN', departureAt: at('2026-12-01T07:30:00Z'), forecast: { precipitationMm: 1 }, now });
    expect(r.factors.map((f) => f.code)).toEqual(['RAIN', 'PEAK_HOURS']);
    expect(r.totalPercent).toBe(20);
    // Fortes pluies remplacent la pluie ; nuit (plage qui passe minuit) ; plafond 30 %.
    const n = priceFactors({ ...D, heavyRain: { ...D.heavyRain, percent: 25 } }, { kind: 'INTERCITY', departureAt: at('2026-12-01T23:00:00Z'), forecast: { precipitationMm: 12 }, now });
    expect(n.factors.map((f) => f.code)).toEqual(['HEAVY_RAIN', 'NIGHT']);
    expect(n.totalPercent).toBe(30);
  });

  it('météo inconnue : aucun facteur météo inventé', () => {
    const r = priceFactors(D, { kind: 'URBAN', departureAt: at('2026-12-01T12:00:00Z'), forecast: null, now });
    expect(r).toEqual({ factors: [], totalPercent: 0 });
  });

  it('embouteillages signalés, jours fériés, week-end, désactivation et type de trajet', () => {
    const rules = {
      ...D,
      trafficAlert: { enabled: true, percent: 15, until: '2026-12-01T18:00:00Z', note: 'travaux au Plateau' },
      holidays: { enabled: true, percent: 5, dates: ['2026-12-05'] },
      weekend: { enabled: true, percent: 5 },
    };
    const a = priceFactors(rules, { kind: 'URBAN', departureAt: at('2026-12-01T12:00:00Z'), forecast: null, now });
    expect(a.factors[0]).toMatchObject({ code: 'TRAFFIC_ALERT', label: 'Embouteillages signalés : travaux au Plateau', source: 'STAFF' });
    expect(priceFactors(rules, { kind: 'URBAN', departureAt: at('2026-12-02T12:00:00Z'), forecast: null, now }).factors).toEqual([]);
    expect(priceFactors(rules, { kind: 'URBAN', departureAt: at('2026-12-05T12:00:00Z'), forecast: null, now }).totalPercent).toBe(10); // samedi férié
    expect(priceFactors({ ...rules, enabled: false }, { kind: 'URBAN', departureAt: at('2026-12-01T12:00:00Z'), forecast: null, now }).totalPercent).toBe(0);
    expect(priceFactors({ ...rules, appliesTo: 'INTERCITY' }, { kind: 'URBAN', departureAt: at('2026-12-01T12:00:00Z'), forecast: null, now }).totalPercent).toBe(0);
  });

  it('valeur enregistrée validée, défaut si illisible', () => {
    expect(dynamicPricingSchema.safeParse({ ...D, night: { ...D.night, from: '25:00' } }).success).toBe(false);
    expect(dynamicPricingSchema.safeParse({ ...D, rain: { ...D.rain, percent: 500 } }).success).toBe(false);
    expect(resolveDynamicPricing({ enabled: false }).enabled).toBe(false);
    expect(resolveDynamicPricing('n’importe quoi')).toEqual(D);
  });
});

describe('tarif dynamique : gamme du véhicule', () => {
  it('Confort et Luxe ajoutent leur supplément, hors plafond des conditions', () => {
    const base = { kind: 'URBAN' as const, departureAt: at('2026-12-01T12:00:00Z'), forecast: null, now };
    expect(priceFactors(D, { ...base, comfortClass: 'ECONOMIQUE' }).totalPercent).toBe(0);
    expect(priceFactors(D, { ...base, comfortClass: 'CONFORT' })).toMatchObject({ totalPercent: 15, factors: [{ code: 'COMFORT', source: 'VEHICLE' }] });
    const night = priceFactors(D, { ...base, departureAt: at('2026-12-01T23:00:00Z'), forecast: { precipitationMm: 30 }, comfortClass: 'LUXE' });
    expect(night.totalPercent).toBe(30 + 40);
  });
});
