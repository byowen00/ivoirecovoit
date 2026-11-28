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

/** Couleurs possibles du véhicule sur la carte ; MARQUE suit la palette choisie. */
export const VEHICLE_COLORS = {
  MARQUE: { label: 'Couleur de la palette', hex: null },
  NUIT: { label: 'Noir', hex: '#11181c' },
  VERT: { label: 'Vert', hex: '#0b6b45' },
  ORANGE: { label: 'Orange', hex: '#c0560a' },
  BLEU: { label: 'Bleu', hex: '#1d4ed8' },
  ROUGE: { label: 'Rouge', hex: '#b42318' },
} as const;
export type VehicleColor = keyof typeof VEHICLE_COLORS;

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
    /** Icône des véhicules sur les cartes : selon le type de trajet (AUTO), voiture, taxi, minibus ou simple point. */
    vehicleIcon: z.enum(['AUTO', 'VOITURE', 'TAXI', 'MINIBUS', 'POINT']),
    /** Couleur du pastille du véhicule (couleurs prédéfinies lisibles sur la carte). */
    vehicleColor: z.enum(Object.keys(VEHICLE_COLORS) as [VehicleColor, ...VehicleColor[]]),
    vehicleSize: z.enum(['PETIT', 'MOYEN', 'GRAND']),
  })
  .strict();
export type Appearance = z.infer<typeof appearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = { theme: 'ORANGE', homeLayout: 'CARTE', defaultTripKind: 'ALL', showPopularRoutes: true, liveDrivers: true,
  vehicleIcon: 'AUTO', vehicleColor: 'MARQUE', vehicleSize: 'MOYEN' };

/** Valeur enregistrée complétée par les valeurs par défaut ; une valeur illisible retombe sur le défaut. */
export function resolveAppearance(stored: unknown) {
  const merged = appearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, ...(typeof stored === 'object' && stored ? stored : {}) });
  const value = merged.success ? merged.data : DEFAULT_APPEARANCE;
  const t = THEMES[value.theme];
  return {
    ...value,
    colors: { brand: t.brand, brandStrong: t.brandStrong, brandSoft: t.brandSoft, accent: t.accent, night: t.night },
    /** Couleur effective du véhicule sur les cartes. */
    vehicleHex: VEHICLE_COLORS[value.vehicleColor].hex ?? t.brand,
  };
}
