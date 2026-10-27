const xof = new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0 });

/** Montant en francs CFA : « 5 300 FCFA ». Les montants sont toujours des entiers. */
export function formatXof(amount: number): string {
  if (!Number.isInteger(amount)) throw new Error(`Montant XOF non entier : ${amount}`);
  // Intl utilise une espace fine insécable ; on la garde pour éviter les retours à la ligne.
  return `${xof.format(amount)} FCFA`;
}

/** Durée estimée lisible : « env. 2 h 45 ». */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60 / 5) * 5;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `env. ${m} min`;
  return m === 0 ? `env. ${h} h` : `env. ${h} h ${String(m).padStart(2, '0')}`;
}

/** Distance indicative : « env. 240 km ». */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `env. ${Math.round(meters / 50) * 50} m`;
  return `env. ${Math.round(meters / 1000)} km`;
}
