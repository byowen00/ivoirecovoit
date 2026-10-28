import { decryptSecret, encryptSecret } from './crypto';
import { base32Encode, hotp, timeStep, verifyTotp } from './totp';

// Vecteurs de la RFC 6238 (SHA-1, secret « 12345678901234567890 »), réduits à 6 chiffres.
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('à T=%i s le code est %s', (seconds, code) => {
    expect(hotp(RFC_SECRET, timeStep(seconds * 1000))).toBe(code);
  });

  it('accepte ±30 s de décalage et refuse au-delà', () => {
    const now = 1_700_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), null, now)).toBeNull();
  });

  it('refuse un code déjà utilisé ou plus ancien', () => {
    const now = 1_700_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step), step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), step - 1, now)).toBeNull();
  });

  it('encode en base32 (RFC 4648)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });
});

describe('chiffrement des secrets TOTP', () => {
  const key = 'k'.repeat(40);

  it('déchiffre ce qu’il a chiffré, avec un IV différent à chaque fois', () => {
    const a = encryptSecret(RFC_SECRET, key);
    const b = encryptSecret(RFC_SECRET, key);
    expect(a.equals(b)).toBe(false);
    expect(decryptSecret(a, key).equals(RFC_SECRET)).toBe(true);
  });

  it('refuse une donnée altérée ou une mauvaise clé', () => {
    const enc = encryptSecret(RFC_SECRET, key);
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(enc, 'z'.repeat(40))).toThrow();
  });
});
