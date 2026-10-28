/*
 * Export CSV protégé contre l'injection de formules (EF-98) : une cellule qui commence par = + - @, une tabulation
 * ou un retour chariot est préfixée d'une apostrophe, pour qu'un tableur ne l'exécute pas. Séparateur « ; »
 * (Excel en français), BOM UTF-8 pour les accents.
 */
const DANGEROUS = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && DANGEROUS.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): Buffer {
  const lines = [header.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}
