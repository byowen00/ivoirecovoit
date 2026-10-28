/** Mise en forme française des textes de notification (heure de Côte d'Ivoire : GMT, sans heure d'été). */

const money = new Intl.NumberFormat('fr-FR');
const dateTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Abidjan',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const time = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', hour: '2-digit', minute: '2-digit' });

export const xof = (n: number) => `${money.format(n)} F CFA`;
export const when = (d: Date) => dateTime.format(d);
export const at = (d: Date) => time.format(d);
export const places = (n: number) => `${n} place${n > 1 ? 's' : ''}`;
