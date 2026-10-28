/*
 * Numéros ivoiriens (plan à 10 chiffres depuis janvier 2021) : +225 suivi de 10 chiffres.
 * Mobiles : préfixes 01 (Moov), 05 (MTN), 07 (Orange). Seuls les mobiles reçoivent un SMS de connexion.
 * La plage +225 00 00 00 00 xx n'est attribuée à personne : elle sert aux comptes [DEMO] et aux tests,
 * et n'est acceptée qu'en mode OTP de test.
 */

const MOBILE = /^0[157]\d{8}$/;
const FIXED = /^2[157]\d{8}$/;
const DEMO = /^00000000\d{2}$/;

export interface PhoneOptions {
  allowDemo?: boolean;
}

/** Normalise une saisie (« 07 07 07 07 07 », « +225 0707070707 », « 00225… ») en E.164, ou null. */
export function normalizeCiMobile(input: string, opts: PhoneOptions = {}): string | null {
  const digits = localDigits(input);
  if (digits && (MOBILE.test(digits) || (opts.allowDemo && DEMO.test(digits)))) return `+225${digits}`;
  return null;
}

/** Mobile ou fixe (contact d'urgence par exemple). */
export function normalizeCiPhone(input: string): string | null {
  const digits = localDigits(input);
  return digits && (MOBILE.test(digits) || FIXED.test(digits)) ? `+225${digits}` : null;
}

function localDigits(input: string): string | null {
  let digits = input.replace(/[\s.\-()]/g, '');
  if (digits.startsWith('+') || digits.startsWith('00225')) {
    digits = digits.replace(/^(\+|00)/, '');
    if (!digits.startsWith('225')) return null;
  }
  if (digits.startsWith('225') && digits.length === 13) digits = digits.slice(3);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** « +2250707070712 » → « +225 07 •• •• •• 12 » : assez pour reconnaître, pas pour appeler. */
export function maskPhone(e164: string | null): string | null {
  if (!e164) return null;
  const local = e164.replace(/^\+225/, '');
  if (local.length !== 10) return `${e164.slice(0, 4)}••••${e164.slice(-2)}`;
  return `+225 ${local.slice(0, 2)} •• •• •• ${local.slice(8)}`;
}

/** « +2250707070712 » → « +225 07 07 07 07 12 » */
export function formatPhone(e164: string): string {
  const local = e164.replace(/^\+225/, '');
  return local.length === 10 ? `+225 ${local.match(/.{2}/g)!.join(' ')}` : e164;
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [name, domain] = email.split('@');
  if (!name || !domain) return '•••';
  return `${name[0]}•••@${domain}`;
}
