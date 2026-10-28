import type { TripStatus } from '../../database/types';
import { assertTransition, canTransition } from './trip-state';

const ALL: TripStatus[] = ['DRAFT', 'PUBLISHED', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

/** Table de référence du doc 05 §1, recopiée à la main : le test compare la règle au code. */
const ALLOWED = new Set([
  'DRAFT>PUBLISHED', 'DRAFT>CANCELLED',
  'PUBLISHED>FULL', 'FULL>PUBLISHED',
  'PUBLISHED>IN_PROGRESS', 'FULL>IN_PROGRESS',
  'IN_PROGRESS>COMPLETED',
  'PUBLISHED>CANCELLED', 'FULL>CANCELLED',
]);

describe('Machine à états des trajets (service)', () => {
  for (const from of ALL) {
    for (const to of ALL.filter((s) => s !== from)) {
      const allowed = ALLOWED.has(`${from}>${to}`);
      it(`${from} -> ${to} : ${allowed ? 'autorisée' : 'refusée'}`, () => {
        expect(canTransition(from, to)).toBe(allowed);
        if (!allowed) expect(() => assertTransition(from, to)).toThrow(/n’est pas possible/);
      });
    }
  }
});
