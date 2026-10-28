import { formatLocalPhone, localMobileDigits } from '@/lib/account';
import { safeNext } from '@/lib/pending-otp';

describe('saisie du téléphone', () => {
  it.each([
    ['07 07 07 07 07', '0707070707'],
    ['+225 05 44 33 22 11', '0544332211'],
    ['0102030405', '0102030405'],
  ])('accepte « %s »', (input, expected) => {
    expect(localMobileDigits(input)).toBe(expected);
  });

  it.each(['27 22 44 55 66', '07 07 07', '09 12 34 56 78'])('refuse « %s »', (input) => {
    expect(localMobileDigits(input)).toBeNull();
  });

  it('formate par paires au fil de la frappe', () => {
    expect(formatLocalPhone('0707')).toBe('07 07');
    expect(formatLocalPhone('07070707071234')).toBe('07 07 07 07 07');
  });
});

describe('redirection après connexion', () => {
  it('n’accepte que des chemins internes', () => {
    expect(safeNext('/compte')).toBe('/compte');
    expect(safeNext('//evil.example')).toBe('/compte');
    expect(safeNext('https://evil.example')).toBe('/compte');
    expect(safeNext(null)).toBe('/compte');
  });
});
