import { z } from 'zod';

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // contrainte SQL size_bytes <= 8 Mio
export const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Date invalide.');

/** Date du jour à Abidjan (UTC+0 toute l'année). */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const futureDate = isoDate.refine((v) => v > todayIso(), 'La date d’expiration doit être dans le futur.');

export const licenseSchema = z.object({
  licenseNumber: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/[\s.-]/g, ''))
    .pipe(z.string().regex(/^[A-Z0-9/]{5,20}$/, 'Numéro de permis invalide (5 à 20 lettres ou chiffres).')),
  licenseExpiresOn: futureDate,
});
export type LicenseInput = z.infer<typeof licenseSchema>;

const uploadBase = {
  mimeType: z.enum(DOCUMENT_MIME_TYPES, { message: 'Format accepté : JPEG, PNG, WebP ou PDF.' }),
  sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES, 'Fichier trop lourd (8 Mo au maximum).'),
  sha256: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'Empreinte SHA-256 attendue (64 caractères hexadécimaux).')
    .transform((v) => v.toLowerCase()),
};

export const DRIVER_DOC_SIDES = {
  NATIONAL_ID: ['FRONT', 'BACK'],
  PASSPORT: ['FRONT'],
  CONSULAR_CARD: ['FRONT', 'BACK'],
  DRIVING_LICENSE: ['FRONT', 'BACK'],
} as const;

export const driverUploadSchema = z
  .object({
    docType: z.enum(['NATIONAL_ID', 'PASSPORT', 'CONSULAR_CARD', 'DRIVING_LICENSE']),
    side: z.enum(['FRONT', 'BACK']).default('FRONT'),
    expiresOn: futureDate.optional(),
    ...uploadBase,
  })
  .refine((v) => (DRIVER_DOC_SIDES[v.docType] as readonly string[]).includes(v.side), {
    path: ['side'],
    message: 'Ce document n’a qu’un recto.',
  });
export type DriverUploadInput = z.infer<typeof driverUploadSchema>;

export const VEHICLE_DOCS_WITH_EXPIRY = ['INSURANCE', 'TECHNICAL_INSPECTION'] as const;

export const vehicleUploadSchema = z
  .object({
    docType: z.enum(['VEHICLE_REGISTRATION', 'INSURANCE', 'TECHNICAL_INSPECTION', 'VEHICLE_PHOTO']),
    expiresOn: futureDate.optional(),
    ...uploadBase,
  })
  .refine((v) => !(VEHICLE_DOCS_WITH_EXPIRY as readonly string[]).includes(v.docType) || !!v.expiresOn, {
    path: ['expiresOn'],
    message: 'Indiquez la date d’expiration figurant sur le document.',
  })
  .refine((v) => v.docType !== 'VEHICLE_PHOTO' || v.mimeType !== 'application/pdf', {
    path: ['mimeType'],
    message: 'La photo du véhicule doit être une image.',
  });
export type VehicleUploadInput = z.infer<typeof vehicleUploadSchema>;

/*
 * Immatriculation ivoirienne, vérification volontairement souple (EF-21) : ancien format « 1234 AB 01 »,
 * format récent « AA-123-AB » et variantes ; 5 à 10 caractères, lettres ET chiffres, séparateurs libres.
 */
const plateSchema = z
  .string()
  .trim()
  .max(15)
  .transform((v) => v.toUpperCase().replace(/\s+/g, ' '))
  .refine((v) => {
    const n = v.replace(/[^A-Z0-9]/g, '');
    return /^[A-Z0-9]{5,10}$/.test(n) && /[A-Z]/.test(n) && /\d/.test(n);
  }, 'Immatriculation invalide (exemples : 1234 AB 01, AA-123-AB).');

const currentYear = new Date().getUTCFullYear();
const vehicleFields = {
  make: z.string().trim().min(2, 'Marque trop courte.').max(40),
  model: z.string().trim().min(1, 'Modèle requis.').max(40),
  color: z.string().trim().min(3, 'Couleur requise.').max(30),
  year: z.number().int().min(1980).max(currentYear + 1).nullable().optional(),
  plateNumber: plateSchema,
  seatsCapacity: z.number().int().min(1, 'Au moins 1 place passager.').max(8, '8 places passagers au maximum.'),
};

export const createVehicleSchema = z.object(vehicleFields);
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object(vehicleFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Aucune modification.');
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
