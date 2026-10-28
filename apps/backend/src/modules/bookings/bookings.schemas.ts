import { z } from 'zod';

const segment = {
  tripId: z.uuid(),
  pickupStopId: z.uuid(),
  dropoffStopId: z.uuid(),
  seats: z.number().int().min(1, 'Une place au minimum.').max(8),
};

export const quoteSchema = z.object(segment);
export type QuoteInput = z.infer<typeof quoteSchema>;

export const createBookingSchema = z.object({
  ...segment,
  // Espèces seulement si la plateforme et le conducteur l'acceptent ; sinon paiement mobile (étape 8).
  paymentMethod: z.literal('CASH').optional(),
  acceptCancellationPolicy: z.literal(true, { error: 'Acceptez les conditions d’annulation pour réserver.' }),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Indiquez un motif (3 caractères minimum).').max(300),
});
export type ReasonInput = z.infer<typeof reasonSchema>;

export const rejectSchema = z.object({ reason: z.string().trim().max(300).optional() });
export type RejectInput = z.infer<typeof rejectSchema>;

export const mineBookingsQuery = z.object({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MineBookingsQuery = z.infer<typeof mineBookingsQuery>;
