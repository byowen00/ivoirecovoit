import { API_INTERNAL_URL } from './server/session';

export interface ThemeColors {
  brand: string;
  brandStrong: string;
  brandSoft: string;
  accent: string;
  night: string;
}
export type ThemeName = 'ORANGE' | 'VERT' | 'BLEU' | 'VIOLET';
export interface AppearanceValue {
  theme: ThemeName;
  homeLayout: 'CARTE' | 'CLASSIQUE';
  defaultTripKind: 'ALL' | 'URBAN' | 'INTERCITY';
  showPopularRoutes: boolean;
}
export interface Appearance extends AppearanceValue {
  colors: ThemeColors;
  themes: Record<ThemeName, ThemeColors & { label: string }>;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Variables CSS de la palette choisie par l'administration ; une couleur mal formée est ignorée. */
export function themeCss(c: Partial<ThemeColors>): string {
  const vars: [string, string | undefined][] = [
    ['--color-brand', c.brand],
    ['--color-brand-strong', c.brandStrong],
    ['--color-brand-soft', c.brandSoft],
    ['--color-accent', c.accent],
    ['--color-night', c.night],
  ];
  const body = vars.filter(([, v]) => v && HEX.test(v)).map(([k, v]) => `${k}:${v};`).join('');
  return body ? `:root{${body}}` : '';
}

/** Lecture côté serveur (mise en cache 60 s) ; en cas d'échec le site garde ses couleurs par défaut. */
export async function fetchAppearance(): Promise<Appearance | null> {
  try {
    const res = await fetch(`${API_INTERNAL_URL}/api/v1/app/appearance`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(1500) });
    return res.ok ? ((await res.json()) as Appearance) : null;
  } catch {
    return null;
  }
}
