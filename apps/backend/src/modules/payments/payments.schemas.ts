import { z } from 'zod';
import { MOBILE_MONEY_METHODS } from './provider';

export const initiatePaymentSchema = z.object({
  method: z.enum(MOBILE_MONEY_METHODS as unknown as ['WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY'], { error: 'Choisissez un moyen de paiement.' }),
  // Numéro qui valide le paiement. Jamais de code secret : il est saisi par le payeur chez l'opérateur.
  payerPhone: z.string().trim().min(8, 'Numéro de téléphone invalide.').max(20),
});
export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;

export const transactionsQuery = z.object({
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type TransactionsQuery = z.infer<typeof transactionsQuery>;

export const earningsQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type EarningsQuery = z.infer<typeof earningsQuery>;
