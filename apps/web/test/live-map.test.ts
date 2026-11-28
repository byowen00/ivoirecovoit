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

import { resolveIcon, styleFromAppearance, vehicleMarker } from '@/lib/vehicle-marker';

describe('véhicules sur la carte (réglés dans « Interface et design »)', () => {
  it('icône selon le trajet, couleur et taille choisies, ou simple point', () => {
    expect(resolveIcon('AUTO', 'INTERCITY')).toBe('MINIBUS');
    expect(resolveIcon('AUTO', 'URBAN')).toBe('VOITURE');
    const car = vehicleMarker({ icon: 'VOITURE', hex: '#0b6b45', size: 'GRAND' });
    expect(car.size).toBe(44);
    expect(car.html).toContain('#0b6b45');
    expect(car.html).toContain('<svg');
    expect(vehicleMarker({ icon: 'POINT', hex: '#0b6b45', size: 'PETIT' }).html).not.toContain('<svg');
    expect(vehicleMarker({ icon: 'TAXI', hex: 'pas une couleur', size: 'MOYEN' }).html).toContain('#c0560a');
    expect(styleFromAppearance(null).icon).toBe('AUTO');
  });
});
