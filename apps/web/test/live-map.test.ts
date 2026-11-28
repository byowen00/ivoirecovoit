import { describe, expect, it } from 'vitest';
import { sharingText } from '@/app/admin/carte/LiveMapView';

describe('carte en temps réel de la console', () => {
  it('dit si la position du conducteur est récente, ancienne ou absente', () => {
    expect(sharingText({ position: null, ageS: null, stale: false })).toContain('non partagée');
    const p = { lat: 5.3, lng: -4, heading: null, recordedAt: '2026-11-28T00:00:00Z' };
    expect(sharingText({ position: p, ageS: 12, stale: false })).toBe('Position il y a 12 s');
    expect(sharingText({ position: p, ageS: 600, stale: true })).toBe('Dernière position il y a 10 min');
  });
});
