import { driverBadge } from './driver-badge';

describe('classement des conducteurs', () => {
  it('pas de badge sans assez d’avis', () => {
    expect(driverBadge(5, 2, null)).toBeNull();
    expect(driverBadge(null, 0, null)).toBeNull();
  });
  it('excellent, très bon, ou rien selon la note et la conduite', () => {
    expect(driverBadge(4.8, 6, { driving: 4.9, n: 6 })).toBe('EXCELLENT');
    expect(driverBadge('4.80', 6, { driving: 4.2, n: 6 })).toBeNull(); // conduite insuffisante
    expect(driverBadge(4.8, 4, null)).toBe('TRES_BON'); // moins de 5 avis
    expect(driverBadge(4.4, 10, { driving: 4.5, n: 3 })).toBe('TRES_BON');
    expect(driverBadge(4.1, 10, null)).toBeNull();
  });
});
