import { useEffect, useState } from 'react';
import { apiGet } from './api';
import type { Appearance } from './appearance';

export type VehicleIcon = 'AUTO' | 'VOITURE' | 'TAXI' | 'MINIBUS' | 'POINT';
export type VehicleSize = 'PETIT' | 'MOYEN' | 'GRAND';
export interface VehicleStyle {
  icon: VehicleIcon;
  hex: string;
  size: VehicleSize;
}
export const DEFAULT_VEHICLE_STYLE: VehicleStyle = { icon: 'AUTO', hex: '#c0560a', size: 'MOYEN' };

const PX: Record<VehicleSize, number> = { PETIT: 26, MOYEN: 34, GRAND: 44 };
// Pictogrammes Material Icons (licence Apache 2.0), dessinés en blanc dans une pastille de couleur.
const PATHS = {
  VOITURE:
    'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  TAXI:
    'M18.92 6.01C18.72 5.42 18.16 5 17.5 5H15V3H9v2H6.5c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  MINIBUS:
    'M17 5H3c-1.1 0-2 .89-2 2v9h2c0 1.65 1.34 3 3 3s3-1.35 3-3h5.5c0 1.65 1.34 3 3 3s3-1.35 3-3H23v-5l-6-6zM3 11V7h4v4H3zm3 6.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM13 11H9V7h4v4zm4.5 6.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM15 11V7h1l4 4h-5z',
} as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** Icône effective : AUTO choisit la voiture en ville et le minibus en interurbain. */
export function resolveIcon(icon: VehicleIcon, kind?: 'URBAN' | 'INTERCITY'): Exclude<VehicleIcon, 'AUTO'> {
  return icon === 'AUTO' ? (kind === 'INTERCITY' ? 'MINIBUS' : 'VOITURE') : icon;
}

/** Marqueur HTML (pour Leaflet) : pastille colorée avec le véhicule, ou simple point. */
export function vehicleMarker(style: VehicleStyle, kind?: 'URBAN' | 'INTERCITY', highlight = false): { html: string; size: number } {
  const icon = resolveIcon(style.icon, kind);
  const size = PX[style.size] + (highlight ? 8 : 0);
  const color = highlight ? '#b85400' : HEX.test(style.hex) ? style.hex : DEFAULT_VEHICLE_STYLE.hex;
  const ring = `border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.35);background:${color}`;
  if (icon === 'POINT') {
    const dot = Math.round(size * 0.55);
    return { html: `<div style="width:${dot}px;height:${dot}px;margin:${(size - dot) / 2}px;${ring}"></div>`, size };
  }
  const inner = Math.round(size * 0.6);
  return {
    html: `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;${ring}"><svg width="${inner}" height="${inner}" viewBox="0 0 24 24" aria-hidden="true"><path fill="${icon === 'TAXI' ? '#ffd400' : '#fff'}" d="${PATHS[icon]}"/></svg></div>`,
    size,
  };
}

export function styleFromAppearance(a: Pick<Appearance, 'vehicleIcon' | 'vehicleHex' | 'vehicleSize'> | null | undefined): VehicleStyle {
  return a?.vehicleIcon ? { icon: a.vehicleIcon, hex: a.vehicleHex ?? DEFAULT_VEHICLE_STYLE.hex, size: a.vehicleSize ?? 'MOYEN' } : DEFAULT_VEHICLE_STYLE;
}

let cached: Promise<VehicleStyle> | null = null;
/** Style des véhicules réglé dans « Interface et design » (lu une fois par page). */
export function useVehicleStyle(): VehicleStyle {
  const [style, setStyle] = useState<VehicleStyle>(DEFAULT_VEHICLE_STYLE);
  useEffect(() => {
    cached ??= apiGet<Appearance>('/app/appearance').then(styleFromAppearance, () => DEFAULT_VEHICLE_STYLE);
    let live = true;
    void cached.then((s) => live && setStyle(s));
    return () => {
      live = false;
    };
  }, []);
  return style;
}
