import { bookingReference, tripReference, uuidv7 } from './ids';

describe('identifiants', () => {
  it('génère des UUID v7 valides et ordonnés dans le temps', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it('génère des références lisibles sans caractères ambigus', () => {
    for (let i = 0; i < 500; i++) {
      expect(bookingReference()).toMatch(/^IC-[A-HJ-NP-Z2-9]{6}$/);
      expect(tripReference()).toMatch(/^T-[A-HJ-NP-Z2-9]{6}$/);
    }
  });
});
