import { z } from 'zod';
import { latitude, longitude } from '../../common/geo';

export const MAX_STOPS = 7; // origine + 5 arrêts intermédiaires + destination (EF-30)

export const stopInput = z
  .object({
    placeId: z.uuid().optional(),
    label: z.string().trim().min(2).max(120).optional(),
    meetingPoint: z.string().trim().min(3).max(200).optional(),
    lat: latitude.optional(),
    lng: longitude.optional(),
  })
  .refine((s) => (s.lat === undefined) === (s.lng === undefined), { message: 'Latitude et longitude vont ensemble.', path: ['lat'] })
  .refine((s) => !!s.placeId || (s.lat !== undefined && !!s.label), {
    message: 'Choisissez un lieu du référentiel, ou donnez un nom et une position.',
    path: ['placeId'],
  });
export type StopInput = z.infer<typeof stopInput>;

const xof = z.number().int('Montant entier en XOF.').min(0);

const routeFields = {
  kind: z.enum(['URBAN', 'INTERCITY']),
  departureAt: z.coerce.date(),
  stops: z.array(stopInput).min(2, 'Un départ et une arrivée au minimum.').max(MAX_STOPS, '5 arrêts intermédiaires au maximum.'),
  pricePerSeatXof: xof.optional(),
  stopPricesXof: z.array(xof).optional(),
};

function pricesConsistent(v: { stops?: unknown[]; pricePerSeatXof?: number; stopPricesXof?: number[] }, ctx: z.RefinementCtx) {
  if (v.stopPricesXof && v.stops && v.stopPricesXof.length !== v.stops.length) {
    ctx.addIssue({ code: 'custom', path: ['stopPricesXof'], message: 'Un prix cumulé par arrêt, origine comprise (0).' });
  }
  if (v.stopPricesXof && v.pricePerSeatXof !== undefined && v.stopPricesXof.at(-1) !== v.pricePerSeatXof) {
    ctx.addIssue({ code: 'custom', path: ['pricePerSeatXof'], message: 'Le prix complet doit égaler le prix cumulé de la destination.' });
  }
}

export const createTripSchema = z
  .object({
    vehicleId: z.uuid(),
    ...routeFields,
    seatsOffered: z.number().int().min(1).max(8),
    acceptanceMode: z.enum(['AUTO', 'MANUAL']).default('AUTO'),
    cancellationPolicy: z.string().trim().min(2).max(20).default('STANDARD'),
    allowsCash: z.boolean().default(false),
    luggagePolicy: z.enum(['NONE', 'SMALL', 'MEDIUM', 'LARGE']).default('MEDIUM'),
    description: z.string().trim().max(1000).optional(),
    instructions: z.string().trim().max(500).optional(),
    publish: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.pricePerSeatXof === undefined && !v.stopPricesXof) {
      ctx.addIssue({ code: 'custom', path: ['pricePerSeatXof'], message: 'Indiquez le prix par place.' });
    }
    pricesConsistent(v, ctx);
  });
export type CreateTripInput = z.infer<typeof createTripSchema>;

/** Aperçu avant publication : itinéraire, horaires et prix suggérés (assistant de l'écran 10). */
export const previewTripSchema = z
  .object({ ...routeFields, vehicleId: z.uuid().optional() })
  .superRefine(pricesConsistent);
export type PreviewTripInput = z.infer<typeof previewTripSchema>;

export const updateTripSchema = z
  .object({
    vehicleId: z.uuid(),
    departureAt: z.coerce.date(),
    stops: routeFields.stops,
    pricePerSeatXof: xof,
    stopPricesXof: z.array(xof),
    seatsOffered: z.number().int().min(1).max(8),
    acceptanceMode: z.enum(['AUTO', 'MANUAL']),
    cancellationPolicy: z.string().trim().min(2).max(20),
    allowsCash: z.boolean(),
    luggagePolicy: z.enum(['NONE', 'SMALL', 'MEDIUM', 'LARGE']),
    description: z.string().trim().max(1000).nullable(),
    instructions: z.string().trim().max(500).nullable(),
  })
  .partial()
  .superRefine((v, ctx) => {
    if (Object.keys(v).length === 0) ctx.addIssue({ code: 'custom', path: [], message: 'Aucune modification.' });
    pricesConsistent(v, ctx);
  });
export type UpdateTripInput = z.infer<typeof updateTripSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ.');

export const duplicateSchema = z.object({
  dates: z
    .array(isoDate)
    .min(1)
    .max(14, '14 dates au maximum.')
    .refine((d) => new Set(d).size === d.length, 'Dates en double.'),
  publish: z.boolean().default(false),
});
export type DuplicateInput = z.infer<typeof duplicateSchema>;

export const cancelSchema = z.object({ reason: z.string().trim().min(5, 'Indiquez un motif (5 caractères minimum).').max(300) });
export type CancelInput = z.infer<typeof cancelSchema>;

export const mineQuery = z.object({
  status: z.enum(['upcoming', 'in_progress', 'past', 'draft']).default('upcoming'),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MineQuery = z.infer<typeof mineQuery>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure au format HH:MM.');
const boolParam = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const searchQuery = z
  .object({
    fromPlaceId: z.uuid().optional(),
    fromLat: z.coerce.number().pipe(latitude).optional(),
    fromLng: z.coerce.number().pipe(longitude).optional(),
    toPlaceId: z.uuid().optional(),
    toLat: z.coerce.number().pipe(latitude).optional(),
    toLng: z.coerce.number().pipe(longitude).optional(),
    date: isoDate.optional(),
    timeFrom: hhmm.optional(),
    timeTo: hhmm.optional(),
    seats: z.coerce.number().int().min(1).max(8).default(1),
    maxPriceXof: z.coerce.number().int().min(0).optional(),
    directOnly: boolParam.default(false),
    radiusKm: z.coerce.number().min(0.5).max(50).optional(),
    sort: z.enum(['departure', 'price', 'distance', 'rating']).default('departure'),
    cursor: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .superRefine((q, ctx) => {
    for (const side of ['from', 'to'] as const) {
      const hasPlace = !!q[`${side}PlaceId`];
      const hasPoint = q[`${side}Lat`] !== undefined && q[`${side}Lng`] !== undefined;
      if (!hasPlace && !hasPoint) {
        ctx.addIssue({ code: 'custom', path: [`${side}PlaceId`], message: side === 'from' ? 'Indiquez le départ.' : 'Indiquez l’arrivée.' });
      }
    }
    if (q.timeFrom && q.timeTo && q.timeFrom > q.timeTo) {
      ctx.addIssue({ code: 'custom', path: ['timeTo'], message: 'L’heure de fin précède l’heure de début.' });
    }
  });
export type SearchQuery = z.infer<typeof searchQuery>;

export const availabilityQuery = z.object({ pickupStopId: z.uuid(), dropoffStopId: z.uuid() });
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;

/** Pagination par position, encodée pour rester opaque côté client. */
export function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString());
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : 0;
}

export function encodeOffset(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}
