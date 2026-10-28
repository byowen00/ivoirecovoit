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
