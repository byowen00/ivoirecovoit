import { z } from 'zod';

/**
 * Apparence du site et de l'appli, réglée par l'administration (paramètre versionné « ui.appearance »).
 * Les couleurs sont des palettes prédéfinies dont le contraste texte blanc / fond a été vérifié (≥ 4,5:1),
 * plutôt que des couleurs libres qui pourraient rendre les boutons illisibles.
 */
export const THEMES = {
  ORANGE: { label: 'Orange et vert (par défaut)', brand: '#c0560a', brandStrong: '#9a4407', brandSoft: '#fff0e3', accent: '#f08a2c', night: '#11181c' },
  VERT: { label: 'Vert forêt', brand: '#0b6b45', brandStrong: '#08533a', brandSoft: '#e3f2ea', accent: '#3dd68c', night: '#0f1f19' },
  BLEU: { label: 'Bleu lagune', brand: '#1d4ed8', brandStrong: '#1e3a8a', brandSoft: '#e8eeff', accent: '#60a5fa', night: '#0f172a' },
  VIOLET: { label: 'Violet', brand: '#6d28d9', brandStrong: '#5b21b6', brandSoft: '#f1eaff', accent: '#a78bfa', night: '#1e1530' },
} as const;
export type ThemeName = keyof typeof THEMES;

export const appearanceSchema = z
  .object({
    /** Palette de couleurs. */
    theme: z.enum(Object.keys(THEMES) as [ThemeName, ...ThemeName[]]),
    /** Accueil de l'appli : carte avec la position (CARTE) ou en-tête sombre sans carte (CLASSIQUE). */
    homeLayout: z.enum(['CARTE', 'CLASSIQUE']),
    /** Choix présélectionné du menu « Tous / En ville / Interurbain ». */
    defaultTripKind: z.enum(['ALL', 'URBAN', 'INTERCITY']),
    /** Afficher « Trajets fréquents » sur l'accueil. */
    showPopularRoutes: z.boolean(),
    /** Carte des conducteurs en circulation (positions approximatives) sur l'accueil. */
    liveDrivers: z.boolean(),
  })
  .strict();
export type Appearance = z.infer<typeof appearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = { theme: 'ORANGE', homeLayout: 'CARTE', defaultTripKind: 'ALL', showPopularRoutes: true, liveDrivers: true };

/** Valeur enregistrée complétée par les valeurs par défaut ; une valeur illisible retombe sur le défaut. */
export function resolveAppearance(stored: unknown) {
  const merged = appearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, ...(typeof stored === 'object' && stored ? stored : {}) });
  const value = merged.success ? merged.data : DEFAULT_APPEARANCE;
  const t = THEMES[value.theme];
  return { ...value, colors: { brand: t.brand, brandStrong: t.brandStrong, brandSoft: t.brandSoft, accent: t.accent, night: t.night } };
}
