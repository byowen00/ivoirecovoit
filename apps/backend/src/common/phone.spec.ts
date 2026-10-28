import { maskEmail, maskPhone, normalizeCiMobile, normalizeCiPhone } from './phone';

describe('numéros ivoiriens', () => {
  it.each([
    ['0707070707', '+2250707070707'],
    ['07 07 07 07 07', '+2250707070707'],
    ['+225 05.44.33.22.11', '+2250544332211'],
    ['00225 0102030405', '+2250102030405'],
    ['2250707070707', '+2250707070707'],
  ])('normalise « %s »', (input, expected) => {
    expect(normalizeCiMobile(input)).toBe(expected);
  });

  it.each(['2722445566', '0907070707', '070707070', '+33612345678', '+1 0707070707', 'abc'])('refuse « %s » comme mobile', (input) => {
    expect(normalizeCiMobile(input)).toBeNull();
  });

  it('n’accepte les numéros de démonstration que sur demande', () => {
    expect(normalizeCiMobile('+2250000000001')).toBeNull();
    expect(normalizeCiMobile('+2250000000001', { allowDemo: true })).toBe('+2250000000001');
  });

  it('accepte les fixes pour un contact d’urgence', () => {
    expect(normalizeCiPhone('27 22 44 55 66')).toBe('+2252722445566');
    expect(normalizeCiPhone('0000000001')).toBeNull();
  });

  it('masque téléphone et e-mail', () => {
    expect(maskPhone('+2250707070712')).toBe('+225 07 •• •• •• 12');
    expect(maskEmail('aya.konan@example.ci')).toBe('a•••@example.ci');
    expect(maskPhone(null)).toBeNull();
  });
});
