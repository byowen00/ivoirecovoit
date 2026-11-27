import { z } from 'zod';
import type { TripKind, VehicleComfort } from '../../database/types';

/*
 * Tarif dynamique (paramètre versionné « pricing.dynamic », réglé dans l'administration).
 * Il ajuste seulement le PRIX SUGGÉRÉ au conducteur, qui reste libre de son prix dans la fourchette autorisée
 * (et sous le plafond « partage de frais » s'il est fixé). Les pourcentages livrés sont des valeurs de
 * démonstration, à valider commercialement avant le lancement.
 */

const percent = z.number().int().min(-50).max(100);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure au format HH:MM.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ.');

export const dynamicPricingSchema = z
  .object({
    enabled: z.boolean(),
    /** Hausse (ou baisse) cumulée maximale, en %. */
    maxTotalPercent: z.number().int().min(0).max(100),
    appliesTo: z.enum(['ALL', 'URBAN', 'INTERCITY']),
    /** Pluie prévue au lieu et à l'heure du départ (prévisions météo). */
    rain: z.object({ enabled: z.boolean(), percent, minMm: z.number().min(0.1).max(50) }).strict(),
    /** Fortes pluies : remplace « pluie » quand le seuil est atteint. */
    heavyRain: z.object({ enabled: z.boolean(), percent, minMm: z.number().min(0.5).max(200) }).strict(),
    /** Embouteillages habituels : heures de pointe (jours 1 = lundi … 7 = dimanche, heure d'Abidjan). */
    peakHours: z
      .object({
        enabled: z.boolean(),
        percent,
        windows: z.array(z.object({ days: z.array(z.number().int().min(1).max(7)).min(1).max(7), from: hhmm, to: hhmm }).strict()).max(10),
      })
      .strict(),
    /** Embouteillages signalés par l'équipe (accident, travaux, manifestation), jusqu'à une date donnée. */
    trafficAlert: z
      .object({ enabled: z.boolean(), percent, until: z.iso.datetime().nullable(), note: z.string().trim().max(120) })
      .strict(),
    /** Départ de nuit. */
    night: z.object({ enabled: z.boolean(), percent, from: hhmm, to: hhmm }).strict(),
    /** Jours fériés et grands événements (dates choisies par l'équipe). */
    holidays: z.object({ enabled: z.boolean(), percent, dates: z.array(day).max(60) }).strict(),
    /** Samedi et dimanche. */
    weekend: z.object({ enabled: z.boolean(), percent }).strict(),
    /** Gamme du véhicule : supplément suggéré pour une voiture Confort ou Luxe (Économique : prix de base). */
    comfort: z.object({ enabled: z.boolean(), confortPercent: percent, luxePercent: percent }).strict(),
  })
  .strict();
export type DynamicPricing = z.infer<typeof dynamicPricingSchema>;

export const DEFAULT_DYNAMIC_PRICING: DynamicPricing = {
  enabled: true,
  maxTotalPercent: 30,
  appliesTo: 'ALL',
  rain: { enabled: true, percent: 10, minMm: 0.5 },
  heavyRain: { enabled: true, percent: 20, minMm: 5 },
  peakHours: {
    enabled: true,
    percent: 10,
    windows: [
      { days: [1, 2, 3, 4, 5], from: '06:30', to: '09:00' },
      { days: [1, 2, 3, 4, 5], from: '16:30', to: '20:00' },
    ],
  },
  trafficAlert: { enabled: false, percent: 15, until: null, note: '' },
  night: { enabled: true, percent: 10, from: '22:00', to: '05:00' },
  holidays: { enabled: false, percent: 10, dates: [] },
  weekend: { enabled: false, percent: 0 },
  comfort: { enabled: true, confortPercent: 15, luxePercent: 40 },
};

export function resolveDynamicPricing(stored: unknown): DynamicPricing {
  if (!stored || typeof stored !== 'object') return DEFAULT_DYNAMIC_PRICING;
  const parsed = dynamicPricingSchema.safeParse({ ...DEFAULT_DYNAMIC_PRICING, ...stored });
  return parsed.success ? parsed.data : DEFAULT_DYNAMIC_PRICING;
}

export type FactorCode = 'RAIN' | 'HEAVY_RAIN' | 'PEAK_HOURS' | 'TRAFFIC_ALERT' | 'NIGHT' | 'HOLIDAY' | 'WEEKEND' | 'COMFORT' | 'LUXE';
export interface PriceFactor {
  code: FactorCode;
  label: string;
  percent: number;
  /** D'où vient l'information : prévision météo, horaires réglés, signalement de l'équipe. */
  source: 'FORECAST' | 'SCHEDULE' | 'STAFF' | 'VEHICLE';
}

/** Précipitations prévues (mm sur l'heure du départ) ; null : météo inconnue (pas de service, trop loin, panne). */
export type Forecast = { precipitationMm: number } | null;

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Vrai si m est dans [from, to[, la plage pouvant passer minuit (22:00 → 05:00). */
const inWindow = (m: number, from: string, to: string) => {
  const a = minutes(from);
  const b = minutes(to);
  return a <= b ? m >= a && m < b : m >= a || m < b;
};

/** Facteurs qui s'appliquent à un départ (heure d'Abidjan = UTC), et le pourcentage total plafonné. */
export function priceFactors(
  rules: DynamicPricing,
  input: { kind: TripKind; departureAt: Date; forecast: Forecast; now?: Date; comfortClass?: VehicleComfort | null },
) {
  const out: PriceFactor[] = [];
  if (!rules.enabled || (rules.appliesTo !== 'ALL' && rules.appliesTo !== input.kind)) return { factors: out, totalPercent: 0 };
  const d = input.departureAt;
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const weekday = ((d.getUTCDay() + 6) % 7) + 1; // 1 = lundi
  const mm = input.forecast?.precipitationMm;
  if (mm !== undefined && rules.heavyRain.enabled && mm >= rules.heavyRain.minMm) {
    out.push({ code: 'HEAVY_RAIN', label: 'Fortes pluies prévues', percent: rules.heavyRain.percent, source: 'FORECAST' });
  } else if (mm !== undefined && rules.rain.enabled && mm >= rules.rain.minMm) {
    out.push({ code: 'RAIN', label: 'Pluie prévue', percent: rules.rain.percent, source: 'FORECAST' });
  }
  if (rules.peakHours.enabled && rules.peakHours.windows.some((w) => w.days.includes(weekday) && inWindow(m, w.from, w.to))) {
    out.push({ code: 'PEAK_HOURS', label: 'Heure de pointe (embouteillages habituels)', percent: rules.peakHours.percent, source: 'SCHEDULE' });
  }
  const now = input.now ?? new Date();
  const alert = rules.trafficAlert;
  if (alert.enabled && alert.until && d.getTime() >= now.getTime() - 3_600_000 && d.getTime() <= new Date(alert.until).getTime()) {
    out.push({ code: 'TRAFFIC_ALERT', label: alert.note ? `Embouteillages signalés : ${alert.note}` : 'Embouteillages signalés', percent: alert.percent, source: 'STAFF' });
  }
  if (rules.night.enabled && inWindow(m, rules.night.from, rules.night.to)) {
    out.push({ code: 'NIGHT', label: 'Départ de nuit', percent: rules.night.percent, source: 'SCHEDULE' });
  }
  if (rules.holidays.enabled && rules.holidays.dates.includes(d.toISOString().slice(0, 10))) {
    out.push({ code: 'HOLIDAY', label: 'Jour férié ou événement', percent: rules.holidays.percent, source: 'STAFF' });
  }
  if (rules.weekend.enabled && weekday >= 6) {
    out.push({ code: 'WEEKEND', label: 'Week-end', percent: rules.weekend.percent, source: 'SCHEDULE' });
  }
  const conditions = out.filter((f) => f.percent !== 0);
  const sum = conditions.reduce((s, f) => s + f.percent, 0);
  // Le plafond cumulé porte sur les conditions (météo, trafic, horaires) ; la gamme s'y ajoute.
  let totalPercent = Math.max(-rules.maxTotalPercent, Math.min(rules.maxTotalPercent, sum));
  const factors = [...conditions];
  if (rules.comfort.enabled && input.comfortClass && input.comfortClass !== 'ECONOMIQUE') {
    const luxe = input.comfortClass === 'LUXE';
    const percent = luxe ? rules.comfort.luxePercent : rules.comfort.confortPercent;
    if (percent !== 0) {
      factors.push({ code: luxe ? 'LUXE' : 'COMFORT', label: luxe ? 'Voiture de luxe' : 'Voiture confort', percent, source: 'VEHICLE' });
      totalPercent += percent;
    }
  }
  return { factors, totalPercent };
}

/**
 * Circulation telle que l'équipe la connaît : alerte saisie dans l'administration et heures de pointe habituelles.
 * Aucune donnée de trafic en temps réel : c'est dit à l'écran.
 */
export function trafficInfo(rules: DynamicPricing, now: Date = new Date()) {
  const a = rules.trafficAlert;
  const alertActive = a.enabled && !!a.until && new Date(a.until).getTime() > now.getTime();
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  const weekday = ((now.getUTCDay() + 6) % 7) + 1;
  const windows = rules.peakHours.enabled ? rules.peakHours.windows : [];
  return {
    alert: alertActive ? { note: a.note || null, until: a.until } : null,
    peakNow: windows.some((w) => w.days.includes(weekday) && inWindow(m, w.from, w.to)),
    peakHours: windows,
    source: 'Informations saisies par l’équipe IvoireCovoit et heures de pointe habituelles, pas de mesure en temps réel.',
  };
}
