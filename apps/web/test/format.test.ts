import { formatDistance, formatDuration, formatXof } from '@/lib/format';

describe('formatXof', () => {
  it('formate en francs CFA avec séparateur de milliers', () => {
    expect(formatXof(5300).replace(/\s/g, ' ')).toBe('5 300 FCFA');
    expect(formatXof(0).replace(/\s/g, ' ')).toBe('0 FCFA');
  });
  it('refuse un montant non entier', () => {
    expect(() => formatXof(10.5)).toThrow();
  });
});

describe('estimations', () => {
  it('arrondit les durées à 5 minutes et les annonce comme estimations', () => {
    expect(formatDuration(9900)).toBe('env. 2 h 45');
    expect(formatDuration(1800)).toBe('env. 30 min');
    expect(formatDuration(7200)).toBe('env. 2 h');
  });
  it('formate les distances', () => {
    expect(formatDistance(241_400)).toBe('env. 241 km');
    expect(formatDistance(420)).toBe('env. 400 m');
  });
});
