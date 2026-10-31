import { clearDraft, DRAFT_KEY, draftDepartureIso, draftPoints, emptyDraft, loadDraft, repeatDates, repeatDaysLabel, saveDraft, stepErrors } from '@/lib/trip-draft';
import type { PlaceSuggestion } from '@/lib/places';

const place = (id: string, label: string): PlaceSuggestion => ({ id, label, name: label, kind: 'CITY', parentName: null, lat: 6, lng: -5, locationPrecision: 'APPROX' });
const abidjan = place('a', 'Abidjan');
const yakro = place('y', 'Yamoussoukro');
const NOW = Date.parse('2026-10-28T10:00:00Z');

beforeEach(() => localStorage.clear());

describe('brouillon de publication', () => {
  it('se sauvegarde et se recharge sur l’appareil', () => {
    const d = { ...emptyDraft('key-1', '2026-11-02'), origin: abidjan, step: 2 as const };
    saveDraft(d);
    const back = loadDraft();
    expect(back?.origin?.label).toBe('Abidjan');
    expect(back?.idempotencyKey).toBe('key-1');
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('ignore un brouillon illisible, d’un autre format ou trop ancien', () => {
    localStorage.setItem(DRAFT_KEY, '{pas du json');
    expect(loadDraft()).toBeNull();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 2 }));
    expect(loadDraft()).toBeNull();
    saveDraft(emptyDraft('k', '2026-11-02'));
    expect(loadDraft(Date.now() + 15 * 86_400_000)).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('continue de fonctionner quand le stockage est bloqué', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveDraft(emptyDraft('k', '2026-11-02'))).not.toThrow();
    spy.mockRestore();
  });

  it('valide chaque étape avant de passer à la suivante', () => {
    const d = emptyDraft('k', '2026-10-28');
    expect(stepErrors(d, 1, NOW)).toEqual(expect.arrayContaining(['Choisissez le lieu de départ.', 'Choisissez le lieu d’arrivée.']));
    const route = { ...d, origin: abidjan, destination: yakro, time: '10:15' };
    expect(stepErrors(route, 1, NOW)).toEqual(['Le départ doit être au moins 30 minutes après maintenant.']);
    const ok = { ...route, time: '11:00' };
    expect(stepErrors(ok, 1, NOW)).toEqual([]);
    expect(stepErrors({ ...ok, destination: abidjan }, 1, NOW)).toContain('Un même lieu apparaît deux fois.');
    expect(stepErrors({ ...ok, stops: [null] }, 1, NOW)).toContain('Choisissez chaque arrêt intermédiaire ou retirez-le.');
    expect(stepErrors(ok, 2, NOW)).toContain('Choisissez un véhicule validé.');
    expect(stepErrors({ ...ok, vehicleId: 'v' }, 3, NOW)).toEqual(['Calculez le prix du trajet.']);
    expect(stepErrors({ ...ok, vehicleId: 'v', stopPrices: [0, 3000] }, 3, NOW)).toEqual([]);
  });

  it('ordonne les points et exprime le départ à l’heure d’Abidjan (UTC)', () => {
    const d = { ...emptyDraft('k', '2026-11-02'), origin: abidjan, stops: [place('t', 'Toumodi')], destination: yakro, time: '07:30' };
    expect(draftPoints(d).map((p) => p.label)).toEqual(['Abidjan', 'Toumodi', 'Yamoussoukro']);
    expect(draftDepartureIso(d)).toBe('2026-11-02T07:30:00.000Z');
  });
});

describe('trajet régulier', () => {
  it('du lundi au vendredi sur les 14 jours suivant le premier départ (lundi 2 novembre)', () => {
    const dates = repeatDates('2026-11-02', [1, 2, 3, 4, 5]);
    expect(dates[0]).toBe('2026-11-03');
    expect(dates.at(-1)).toBe('2026-11-16');
    expect(dates).toHaveLength(10);
    expect(dates).not.toContain('2026-11-08'); // dimanche
    expect(repeatDaysLabel([5, 1, 2, 3, 4])).toBe('du lundi au vendredi');
  });

  it('tous les jours : 14 copies au plus, aucune sans jour choisi', () => {
    expect(repeatDates('2026-11-02', [1, 2, 3, 4, 5, 6, 7])).toHaveLength(14);
    expect(repeatDates('2026-11-02', [])).toEqual([]);
    expect(repeatDaysLabel([1, 3])).toBe('lundi, mercredi');
  });
});
