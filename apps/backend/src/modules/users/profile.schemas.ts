import { z } from 'zod';

const NAME = /^[\p{L}][\p{L}' .-]*$/u;
const name = z
  .string()
  .trim()
  .min(1, 'Champ obligatoire.')
  .max(60, '60 caractères maximum.')
  .regex(NAME, 'Lettres, espaces, apostrophes et tirets uniquement.');

export const LANGUAGES = ['fr', 'en', 'dioula', 'baoule', 'bete', 'senoufo', 'agni', 'autre'] as const;

export const preferencesSchema = z
  .object({
    smoking: z.boolean().optional(),
    music: z.boolean().optional(),
    pets: z.boolean().optional(),
    chat: z.enum(['QUIET', 'SOME', 'CHATTY']).optional(),
    languages: z.array(z.enum(LANGUAGES)).max(LANGUAGES.length).optional(),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;

export const updateProfileSchema = z
  .object({
    firstName: name.optional(),
    lastName: name.optional(),
    bio: z.string().trim().max(300, '300 caractères maximum.').nullable().optional(),
    email: z.email('Adresse e-mail invalide.').max(254).toLowerCase().nullable().optional(),
    preferences: preferencesSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Aucune modification.');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const consentSchema = z
  .object({
    type: z.enum(['TERMS', 'PRIVACY', 'LOCATION_LIVE', 'MARKETING']),
    version: z.string().trim().min(1).max(20),
    granted: z.boolean(),
  })
  .strict();
export type ConsentInput = z.infer<typeof consentSchema>;

export const emergencyContactSchema = z
  .object({
    name: z.string().trim().min(1, 'Champ obligatoire.').max(80),
    phone: z.string().trim().min(8).max(25),
  })
  .strict();
