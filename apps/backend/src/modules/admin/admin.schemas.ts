import { z } from 'zod';

export const listUsersQuery = z.object({
  q: z.string().trim().min(2).max(60).optional(),
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED']).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListUsersQuery = z.infer<typeof listUsersQuery>;

const reason = z.string().trim().min(10, 'Motif obligatoire (10 caractères minimum).').max(500);

export const revealSchema = z
  .object({ reason, fields: z.array(z.enum(['phone', 'email'])).min(1).max(2) })
  .strict();
export type RevealInput = z.infer<typeof revealSchema>;

export const suspendSchema = z
  .object({ reason, until: z.coerce.date().optional() })
  .strict();
export type SuspendInput = z.infer<typeof suspendSchema>;

export const unsuspendSchema = z.object({ reason }).strict();

export const auditQuery = z.object({
  targetId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  action: z.string().max(60).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQuery = z.infer<typeof auditQuery>;

export const verificationListQuery = z.object({
  type: z.enum(['driver', 'vehicle', 'document']),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type VerificationListQuery = z.infer<typeof verificationListQuery>;

export const verificationType = z.enum(['driver', 'vehicle', 'document']);
export type VerificationType = z.infer<typeof verificationType>;

export const approveSchema = z.object({ note: z.string().trim().max(300).optional() }).strict();
export type ApproveInput = z.infer<typeof approveSchema>;

export const rejectSchema = z
  .object({
    // Montré tel quel au conducteur : « Photo de l'assurance illisible ».
    reason: z.string().trim().min(5, 'Motif obligatoire, il sera montré au conducteur.').max(300),
    documentIds: z.array(z.uuid()).max(20).default([]),
  })
  .strict();
export type RejectInput = z.infer<typeof rejectSchema>;

export const documentViewSchema = z.object({ reason }).strict();
