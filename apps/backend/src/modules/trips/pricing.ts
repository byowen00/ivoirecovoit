/*
 * Prix des segments (EF-31, doc 05 §8). Un trajet porte, pour chaque arrêt, le prix cumulé depuis l'origine :
 * le prix du segment a -> b vaut p[b] - p[a]. Tous les montants sont des entiers XOF multiples de 50.
 */

export const PRICE_STEP_XOF = 50;

export interface PriceBounds {
  minXof: number;
  maxXof: number;
  /** Plafond « partage de frais » par km (null : pas encore fixé, non appliqué). */
  capXofPerKm: number | null;
}

export type PriceProblem =
  | { code: 'NOT_MULTIPLE_OF_50'; index: number }
  | { code: 'ORIGIN_NOT_ZERO' }
  | { code: 'NOT_INCREASING'; index: number }
  | { code: 'BELOW_MIN'; from: number; to: number; priceXof: number }
  | { code: 'ABOVE_MAX'; priceXof: number }
  | { code: 'ABOVE_KM_CAP'; from: number; to: number; priceXof: number; capXof: number };

export function roundToStep(xof: number): number {
  return Math.round(xof / PRICE_STEP_XOF) * PRICE_STEP_XOF;
}

/** Répartit un prix complet au prorata des distances des tronçons, arrondi à 50 XOF (le dernier vaut le prix complet). */
export function suggestStopPrices(legDistancesM: number[], fullPriceXof: number): number[] {
  const total = legDistancesM.reduce((s, d) => s + d, 0);
  const prices = [0];
  let cumulative = 0;
  for (let i = 0; i < legDistancesM.length; i++) {
    cumulative += legDistancesM[i]!;
    prices.push(i === legDistancesM.length - 1 ? fullPriceXof : total > 0 ? roundToStep((fullPriceXof * cumulative) / total) : fullPriceXof);
  }
  // L'arrondi ne doit jamais rendre un tronçon gratuit ou négatif.
  for (let i = 1; i < prices.length; i++) {
    if (prices[i]! <= prices[i - 1]!) prices[i] = Math.min(prices[i - 1]! + PRICE_STEP_XOF, fullPriceXof);
  }
  return prices;
}

/** Prix complet suggéré à partir de la distance estimée, ramené dans les bornes. */
export function suggestFullPrice(distanceM: number, xofPerKm: number, bounds: PriceBounds): number {
  const raw = roundToStep((distanceM / 1000) * xofPerKm);
  return Math.min(Math.max(raw, bounds.minXof), bounds.maxXof);
}

/** Vérifie tous les segments réservables (n ≤ 7 arrêts : 21 couples au plus). */
export function checkStopPrices(prices: number[], legDistancesM: number[], bounds: PriceBounds): PriceProblem[] {
  const problems: PriceProblem[] = [];
  if (prices[0] !== 0) problems.push({ code: 'ORIGIN_NOT_ZERO' });
  prices.forEach((p, index) => {
    if (!Number.isInteger(p) || p % PRICE_STEP_XOF !== 0) problems.push({ code: 'NOT_MULTIPLE_OF_50', index });
    if (index > 0 && p <= prices[index - 1]!) problems.push({ code: 'NOT_INCREASING', index });
  });
  if (problems.length) return problems;
  const full = prices[prices.length - 1]!;
  if (full > bounds.maxXof) problems.push({ code: 'ABOVE_MAX', priceXof: full });
  for (let from = 0; from < prices.length - 1; from++) {
    for (let to = from + 1; to < prices.length; to++) {
      const priceXof = prices[to]! - prices[from]!;
      if (priceXof < bounds.minXof) problems.push({ code: 'BELOW_MIN', from, to, priceXof });
      if (bounds.capXofPerKm !== null) {
        const km = legDistancesM.slice(from, to).reduce((s, d) => s + d, 0) / 1000;
        const capXof = Math.floor((km * bounds.capXofPerKm) / PRICE_STEP_XOF) * PRICE_STEP_XOF;
        if (priceXof > capXof) problems.push({ code: 'ABOVE_KM_CAP', from, to, priceXof, capXof });
      }
    }
  }
  return problems;
}
