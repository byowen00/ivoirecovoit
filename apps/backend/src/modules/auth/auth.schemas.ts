import { z } from 'zod';

export const otpRequestSchema = z
  .object({
    phone: z.string().trim().min(8, 'Numéro invalide.').max(25, 'Numéro invalide.'),
    purpose: z.literal('LOGIN').default('LOGIN'),
  })
  .strict();

export const otpVerifySchema = z
  .object({
    otpRequestId: z.uuid('Demande invalide.'),
    code: z.string().trim().regex(/^\d{6}$/, 'Le code contient 6 chiffres.'),
    deviceLabel: z.string().trim().max(100).optional(),
  })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();

export const staffLoginSchema = z
  .object({
    email: z.email('Adresse e-mail invalide.').max(254),
    password: z.string().min(1).max(200),
    totp: z.string().trim().regex(/^\d{6}$/, 'Le code contient 6 chiffres.'),
  })
  .strict();

export const deletionSchema = z
  .object({
    otpRequestId: z.uuid('Demande invalide.'),
    code: z.string().trim().regex(/^\d{6}$/, 'Le code contient 6 chiffres.'),
  })
  .strict();
