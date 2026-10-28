import { z } from 'zod';

export const messageSchema = z.object({
  body: z.string().trim().min(1, 'Message vide.').max(1000, '1 000 caractères au maximum.'),
});
export const messagesQuery = z.object({ after: z.uuid().optional() });

export const reviewSchema = z.object({
  rating: z.number().int().min(1, 'Note de 1 à 5.').max(5, 'Note de 1 à 5.'),
  comment: z.string().trim().max(500, '500 caractères au maximum.').optional(),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

export const userReviewsQuery = z.object({
  role: z.enum(['DRIVER', 'PASSENGER']).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type UserReviewsQuery = z.infer<typeof userReviewsQuery>;

export const reportSchema = z.object({
  targetType: z.enum(['USER', 'TRIP', 'MESSAGE', 'REVIEW', 'VEHICLE']),
  targetId: z.uuid(),
  bookingId: z.uuid().optional(),
  category: z.enum(['DANGEROUS_DRIVING', 'HARASSMENT', 'FRAUD', 'NO_SHOW', 'INAPPROPRIATE', 'OTHER']),
  description: z.string().trim().min(10, 'Décrivez le problème (10 caractères minimum).').max(2000),
});
export type ReportBody = z.infer<typeof reportSchema>;

export const disputeSchema = z.object({
  bookingId: z.uuid(),
  reasonCode: z.enum(['DRIVER_NO_SHOW', 'PASSENGER_NO_SHOW', 'TRIP_NOT_DONE', 'LATE', 'AMOUNT', 'OTHER']),
  description: z.string().trim().min(10, 'Décrivez le problème (10 caractères minimum).').max(2000),
});
export type DisputeBody = z.infer<typeof disputeSchema>;

export const disputeMessageSchema = z.object({ body: z.string().trim().min(2, 'Message trop court.').max(2000) });
