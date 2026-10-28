import { redactContacts } from './redact';

describe('masquage des coordonnées dans la messagerie (EF-80)', () => {
  it.each([
    ['Appelle-moi au 07 07 07 07 07', 'Appelle-moi au [masqué]'],
    ['mon numéro : +225 0102030405 merci', 'mon numéro : [masqué] merci'],
    ['0707070707', '[masqué]'],
    ['07.07.07.07.07 ou 05-06-07-08-09', '[masqué] ou [masqué]'],
    ['écris à koffi.k@exemple.ci', 'écris à [masqué]'],
    ['voir https://exemple.com/x?y=1 et www.site.ci', 'voir [masqué] et [masqué]'],
    ['whatsapp wa.me/2250707070707', 'whatsapp [masqué]'],
    ['mon site koffi-transport.com', 'mon site [masqué]'],
  ])('%s', (input, expected) => {
    expect(redactContacts(input)).toEqual({ text: expected, redacted: true });
  });

  it('laisse intacts les messages ordinaires, les heures et les petits nombres', () => {
    for (const text of ['Je serai là à 7h30 devant la pharmacie', 'Nous serons 2 avec 1 sac', 'Rendez-vous gare de Bassam, quai 12', 'Prix 5000 F, ok ?']) {
      expect(redactContacts(text)).toEqual({ text, redacted: false });
    }
  });
});
