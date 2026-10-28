/*
 * Masquage des coordonnées dans la messagerie avant confirmation de la réservation (EF-80) : numéros de
 * téléphone, adresses e-mail et liens externes, pour que l'échange et le paiement restent sur la plateforme.
 */
const MASK = '[masqué]';

const PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // e-mail
  /\b(?:https?:\/\/|www\.)\S+/gi, // lien explicite
  /\b(?:wa\.me|t\.me|bit\.ly|goo\.gl|tinyurl\.com)\/\S*/gi, // raccourcis et messageries
  /\b[a-z0-9-]+\.(?:com|ci|net|org|fr|info|biz|io|me|co|app|ly|link|site|online)\b(?:\/\S*)?/gi, // nom de domaine
  /(?:\+|00)?\d(?:[\s.\-/()]*\d){7,}/g, // 8 chiffres ou plus, séparateurs compris (07 07 07 07 07, +225…)
];

export function redactContacts(text: string): { text: string; redacted: boolean } {
  let out = text;
  for (const p of PATTERNS) out = out.replace(p, MASK);
  return { text: out, redacted: out !== text };
}
