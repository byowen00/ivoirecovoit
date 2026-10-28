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

// --- Étape 9 : exploitation, finance, confiance, configuration, personnel ---

const page = { cursor: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) };
const shortReason = z.string().trim().min(5, 'Motif obligatoire (5 caractères minimum).').max(500);
const xof = z.number().int().min(0).max(100_000_000);
const day = z.coerce.date();

export const tripsQuery = z.object({
  ...page,
  status: z.enum(['DRAFT', 'PUBLISHED', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  q: z.string().trim().min(2).max(60).optional(),
  driverId: z.uuid().optional(),
});
export type TripsQuery = z.infer<typeof tripsQuery>;

export const bookingsQuery = z.object({
  ...page,
  status: z
    .enum(['PENDING_ACCEPTANCE', 'PENDING_PAYMENT', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER',
           'CANCELLED_BY_ADMIN', 'COMPLETED', 'NO_SHOW'])
    .optional(),
  q: z.string().trim().min(2).max(60).optional(),
  tripId: z.uuid().optional(),
  userId: z.uuid().optional(),
});
export type BookingsQuery = z.infer<typeof bookingsQuery>;

export const paymentsQuery = z.object({ ...page, status: z.string().max(30).optional(), bookingId: z.uuid().optional() });
export type PaymentsQuery = z.infer<typeof paymentsQuery>;

export const reasonOnlySchema = z.object({ reason: shortReason }).strict();
export type ReasonOnlyInput = z.infer<typeof reasonOnlySchema>;

export const noteTarget = z.enum(['USER', 'TRIP', 'BOOKING']);
export const notesQuery = z.object({ targetType: noteTarget, targetId: z.uuid() });
export const noteSchema = z.object({ targetType: noteTarget, targetId: z.uuid(), body: z.string().trim().min(2).max(2000) }).strict();

export const refundSchema = z
  .object({
    bookingId: z.uuid(),
    amountXof: z.number().int().min(1, 'Montant supérieur à 0.').max(10_000_000),
    reasonCode: z.enum(['ADMIN', 'DISPUTE']).default('ADMIN'),
    note: shortReason,
  })
  .strict();
export type RefundInput = z.infer<typeof refundSchema>;

export const refundsQuery = z.object({ ...page, status: z.enum(['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'MANUAL_REQUIRED', 'REJECTED']).optional() });
export const commissionsQuery = z.object({ ...page, status: z.enum(['PENDING', 'PAYABLE', 'IN_PAYOUT', 'PAID', 'VOID']).optional(), driverId: z.uuid().optional() });
export const payoutsQuery = z.object({ ...page, status: z.enum(['DRAFT', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED']).optional() });
export const generatePayoutsSchema = z.object({ until: day, driverId: z.uuid().optional() }).strict();
export const markPaidSchema = z
  .object({
    externalReference: z.string().trim().min(3, 'Référence du virement obligatoire.').max(100),
    method: z.enum(['WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY']).optional(),
  })
  .strict();
export const reconciliationRunSchema = z.object({ from: day, to: day }).strict();
export const resolveItemSchema = z.object({ note: shortReason }).strict();
export const exportSchema = z.object({ type: z.enum(['TRANSACTIONS', 'BOOKINGS', 'REFUNDS', 'COMMISSIONS']), from: day, to: day }).strict();

export const disputesQuery = z.object({
  ...page,
  status: z.enum(['OPEN', 'AWAITING_RESPONSE', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED']).optional(),
  open: z.stringbool().optional(),
  assignedTo: z.uuid().optional(),
});
export const disputeUpdateSchema = z
  .object({ assignToMe: z.boolean().optional(), unassign: z.boolean().optional(), status: z.enum(['IN_REVIEW', 'CLOSED']).optional() })
  .strict();
export const disputeMessageSchema = z.object({ body: z.string().trim().min(2).max(2000), internal: z.boolean().default(false) }).strict();
export const decideSchema = z
  .object({
    decision: z.enum(['NO_REFUND', 'PARTIAL_REFUND', 'FULL_REFUND', 'DRIVER_PENALTY', 'REJECT']),
    refundXof: xof.optional(),
    note: shortReason,
  })
  .strict();

export const reportsQuery = z.object({
  ...page,
  status: z.enum(['OPEN', 'IN_REVIEW', 'ACTION_TAKEN', 'DISMISSED']).optional(),
  open: z.stringbool().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
});
export const reportUpdateSchema = z
  .object({
    status: z.enum(['OPEN', 'IN_REVIEW', 'ACTION_TAKEN', 'DISMISSED']).optional(),
    resolution: z.string().trim().max(1000).optional(),
    assignToMe: z.boolean().optional(),
  })
  .strict();
export const hideSchema = z.object({ hidden: z.boolean(), reason: shortReason }).strict();

export const settingSchema = z.object({ value: z.unknown(), reason: shortReason }).strict();

const bps = z.number().int().min(0).max(5000);
export const feeRuleSchema = z
  .object({
    effectiveFrom: day,
    tripKind: z.enum(['URBAN', 'INTERCITY']).nullable().default(null),
    commissionBps: bps,
    commissionFixedXof: xof.default(0),
    commissionMinXof: xof.default(0),
    commissionMaxXof: xof.nullable().default(null),
    serviceFeeBps: bps,
    serviceFeeFixedXof: xof.default(0),
    serviceFeeMinXof: xof.default(0),
    serviceFeeMaxXof: xof.nullable().default(null),
    reason: shortReason,
  })
  .strict();

export const promotionSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,30}$/, 'Lettres, chiffres et tirets (3 à 30).'),
    description: z.string().trim().max(200).optional(),
    discountType: z.enum(['FIXED', 'PERCENT']),
    // FIXED : F CFA ; PERCENT : pourcentage entier (10 = 10 %).
    discountValue: z.number().int().min(1).max(1_000_000),
    maxDiscountXof: xof.nullable().optional(),
    minTotalXof: xof.default(0),
    startsAt: day,
    endsAt: day,
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
    maxPerUser: z.number().int().min(1).max(100).default(1),
    firstTripOnly: z.boolean().default(false),
  })
  .strict();
export const promotionUpdateSchema = z
  .object({
    description: z.string().trim().max(200).optional(),
    endsAt: day.optional(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const lat = z.number().min(4).max(11);
const lng = z.number().min(-9).max(-2);
export const placesQuery = z.object({ ...page, q: z.string().trim().min(1).max(60).optional(), kind: z.enum(['CITY', 'COMMUNE', 'NEIGHBORHOOD', 'LANDMARK', 'STATION']).optional() });
export const placeSchema = z
  .object({
    kind: z.enum(['CITY', 'COMMUNE', 'NEIGHBORHOOD', 'LANDMARK', 'STATION']),
    name: z.string().trim().min(2).max(100),
    parentId: z.uuid().optional(),
    aliases: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    lat,
    lng,
    precision: z.enum(['EXACT', 'APPROX']).default('APPROX'),
  })
  .strict();
export const placeUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    aliases: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    isActive: z.boolean().optional(),
    lat: lat.optional(),
    lng: lng.optional(),
    precision: z.enum(['EXACT', 'APPROX']).optional(),
  })
  .strict()
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), { message: 'Latitude et longitude vont ensemble.', path: ['lat'] });

export const periodQuery = z.object({ from: day.optional(), to: day.optional() });
export const statsQuery = z.object({
  groupBy: z.enum(['city', 'route', 'period', 'kind']).default('period'),
  from: day.optional(),
  to: day.optional(),
  interval: z.enum(['day', 'week', 'month']).default('day'),
});

const staffRole = z.enum(['SUPPORT', 'ADMIN', 'FINANCE', 'SUPER_ADMIN']);
export const staffCreateSchema = z
  .object({
    email: z.email().toLowerCase(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    role: staffRole,
    password: z.string().min(12, 'Mot de passe : 12 caractères minimum.').max(200),
  })
  .strict();
export const staffRolesSchema = z.object({ roles: z.array(staffRole).min(1).max(4), reason: shortReason }).strict();
export const staffActiveSchema = z.object({ active: z.boolean(), reason: shortReason }).strict();
