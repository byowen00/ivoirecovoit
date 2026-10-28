import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { TripKind } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import type { AuthContext } from '../auth/request-context';

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} introuvable.`);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, code, message);
const invalid = (fields: Record<string, string>) => new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', { fields });
const role = (a: AuthContext) => a.roles.join(',');

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const methods = z.array(z.enum(['WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY'])).max(4);

/**
 * Paramètres modifiables depuis l'administration (EF-96), avec leur validation. Toute autre clé est refusée :
 * on ne crée pas de paramètre au hasard. Chaque modification crée une nouvelle version (l'historique reste).
 */
export const SETTINGS: Record<string, { label: string; schema: z.ZodType; group: string }> = {
  'booking.hold_minutes': { group: 'Réservations', label: 'Durée de blocage des places en attente de paiement (min)', schema: int(5, 60) },
  'booking.hold_extension_minutes': { group: 'Réservations', label: 'Prolongation si un paiement est en cours (min)', schema: int(0, 30) },
  'booking.min_minutes_before_departure': { group: 'Réservations', label: 'Réservation possible jusqu’à N min avant le départ', schema: int(0, 600) },
  'booking.manual_acceptance_hours': { group: 'Réservations', label: 'Délai de réponse du conducteur (h)', schema: int(1, 48) },
  'booking.max_pending_per_passenger': { group: 'Réservations', label: 'Demandes en attente par passager', schema: int(1, 10) },
  'booking.max_seats_per_booking': { group: 'Réservations', label: 'Places par réservation', schema: int(1, 8) },
  'booking.max_creations_per_hour': { group: 'Réservations', label: 'Réservations créées par heure et par passager', schema: int(1, 100) },
  'booking.no_show_delay_minutes': { group: 'Réservations', label: 'Délai avant de signaler un passager absent (min)', schema: int(5, 120) },
  'booking.late_driver_free_cancel_minutes': { group: 'Réservations', label: 'Retard du conducteur ouvrant l’annulation sans frais (min)', schema: int(5, 240) },
  'trip.price_min_xof': { group: 'Trajets et prix', label: 'Prix minimum par place (F CFA)', schema: int(0, 100_000) },
  'trip.price_max_xof': { group: 'Trajets et prix', label: 'Prix maximum par place (F CFA)', schema: int(100, 500_000) },
  'trip.suggested_price_xof_per_km': { group: 'Trajets et prix', label: 'Prix suggéré au conducteur (F CFA par km)', schema: int(0, 1000) },
  'trip.price_cap_xof_per_km': { group: 'Trajets et prix', label: 'Plafond « partage de frais » (F CFA par km, vide = non appliqué)', schema: int(1, 1000).nullable() },
  'trip.max_days_ahead': { group: 'Trajets et prix', label: 'Publication jusqu’à N jours à l’avance', schema: int(1, 365) },
  'payments.cash_enabled': { group: 'Paiement', label: 'Paiement en espèces autorisé', schema: z.boolean() },
  'payments.enabled_methods': { group: 'Paiement', label: 'Moyens de paiement proposés', schema: methods },
  'refunds.support_cap_xof': { group: 'Remboursements', label: 'Plafond de remboursement d’un agent de support (F CFA)', schema: int(0, 1_000_000) },
  'refunds.double_validation_above_xof': { group: 'Remboursements', label: 'Double validation au-delà de (F CFA)', schema: int(0, 10_000_000) },
  'finance.driver_payable_after_hours': { group: 'Remboursements', label: 'Gains disponibles N heures après la fin du trajet', schema: int(0, 720) },
  'reviews.window_days': { group: 'Confiance', label: 'Délai pour laisser un avis (jours)', schema: int(1, 60) },
  'disputes.window_days': { group: 'Confiance', label: 'Délai pour ouvrir une réclamation (jours)', schema: int(1, 60) },
  'disputes.response_hours': { group: 'Confiance', label: 'Délai de réponse de l’autre partie (h)', schema: int(1, 240) },
  'messages.max_per_10_minutes': { group: 'Confiance', label: 'Messages par conversation et par 10 min', schema: int(1, 200) },
  'reports.max_per_day': { group: 'Confiance', label: 'Signalements par jour et par personne', schema: int(1, 100) },
  'share.expiry_hours_after_arrival': { group: 'Sécurité', label: 'Lien de partage valable N heures après l’arrivée', schema: int(1, 72) },
  'notifications.reminder_hours': { group: 'Notifications', label: 'Rappels avant le départ (heures)', schema: z.array(int(1, 72)).max(4) },
  'safety.emergency_numbers': {
    group: 'Sécurité',
    label: 'Numéros d’urgence affichés (à faire valider)',
    schema: z.object({
      _status: z.string().max(100).optional(),
      numbers: z.array(z.object({ label: z.string().trim().min(2).max(60), phone: z.string().trim().regex(/^\+?[0-9]{2,15}$/) })).min(1).max(12),
    }),
  },
};

/**
 * Configuration (EF-96, EF-97) et indicateurs (EF-90, EF-98) : paramètres versionnés, règles de frais
 * (nouvelle version datée, jamais de modification d'une version utilisée), promotions, référentiel des lieux.
 */
@Injectable()
export class AdminConfigService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ paramètres

  async settingsList() {
    const rows = await this.db
      .selectFrom('settings')
      .select(['key', 'value', 'version', 'updated_at', 'updated_by'])
      .distinctOn('key')
      .orderBy('key')
      .orderBy('version', 'desc')
      .execute();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return {
      data: Object.entries(SETTINGS).map(([key, def]) => {
        const r = byKey.get(key);
        return { key, group: def.group, label: def.label, value: r?.value ?? null, version: r?.version ?? 0, updatedAt: r?.updated_at ?? null };
      }),
    };
  }

  async settingHistory(key: string) {
    if (!SETTINGS[key]) throw notFound('Paramètre');
    const rows = await this.db
      .selectFrom('settings')
      .leftJoin('users', 'users.id', 'settings.updated_by')
      .select(['settings.value', 'settings.version', 'settings.updated_at', 'users.display_name'])
      .where('key', '=', key)
      .orderBy('version', 'desc')
      .limit(50)
      .execute();
    return { key, label: SETTINGS[key].label, versions: rows.map((r) => ({ version: r.version, value: r.value, updatedAt: r.updated_at, updatedBy: r.display_name })) };
  }

  async putSetting(staff: AuthContext, key: string, value: unknown, reason: string, ctx: RequestContext) {
    const def = SETTINGS[key];
    if (!def) throw notFound('Paramètre');
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) throw invalid({ value: parsed.error.issues[0]?.message ?? 'Valeur invalide.' });
    if (key === 'trip.price_max_xof' || key === 'trip.price_min_xof') {
      const other = await this.db.selectFrom('settings').select('value').where('key', '=', key === 'trip.price_max_xof' ? 'trip.price_min_xof' : 'trip.price_max_xof')
        .orderBy('version', 'desc').limit(1).executeTakeFirst();
      const [min, max] = key === 'trip.price_max_xof' ? [Number(other?.value ?? 0), parsed.data as number] : [parsed.data as number, Number(other?.value ?? Infinity)];
      if (min >= max) throw invalid({ value: 'Le prix minimum doit rester inférieur au prix maximum.' });
    }
    await this.db.transaction().execute(async (trx) => {
      // Verrou consultatif par clé : deux modifications simultanées ne prennent pas le même numéro de version.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`settings:${key}`}))`.execute(trx);
      const current = await trx.selectFrom('settings').select(['version', 'value']).where('key', '=', key).orderBy('version', 'desc').limit(1).executeTakeFirst();
      await trx.insertInto('settings').values({ key, value: JSON.stringify(parsed.data), version: (current?.version ?? 0) + 1, updated_by: staff.userId }).execute();
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'setting.changed', targetType: 'setting', reason,
                             changes: { key, from: current?.value ?? null, to: parsed.data, version: (current?.version ?? 0) + 1 }, ctx }, trx);
    });
    return this.settingHistory(key);
  }

  // ------------------------------------------------------------------ règles de frais

  async feeRules() {
    const rows = await this.db.selectFrom('fee_rules').selectAll().orderBy('effective_from', 'desc').limit(100).execute();
    const now = Date.now();
    return {
      // Rappel : aucun taux n'est validé commercialement ; les valeurs de démonstration sont marquées.
      data: rows.map((r) => ({
        id: r.id, tripKind: r.trip_kind, effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
        current: r.effective_from.getTime() <= now && (!r.effective_to || r.effective_to.getTime() > now),
        commissionBps: r.commission_bps, commissionFixedXof: r.commission_fixed_xof, commissionMinXof: r.commission_min_xof, commissionMaxXof: r.commission_max_xof,
        serviceFeeBps: r.service_fee_bps, serviceFeeFixedXof: r.service_fee_fixed_xof, serviceFeeMinXof: r.service_fee_min_xof, serviceFeeMaxXof: r.service_fee_max_xof,
        isDemo: r.is_demo, createdAt: r.created_at,
      })),
    };
  }

  /** Nouvelle version datée : la version en cours prend fin à cette date ; les réservations existantes gardent leur règle. */
  async createFeeRule(
    staff: AuthContext,
    input: {
      effectiveFrom: Date; tripKind: TripKind | null; commissionBps: number; commissionFixedXof: number; commissionMinXof: number; commissionMaxXof: number | null;
      serviceFeeBps: number; serviceFeeFixedXof: number; serviceFeeMinXof: number; serviceFeeMaxXof: number | null; reason: string;
    },
    ctx: RequestContext,
  ) {
    if (input.effectiveFrom.getTime() < Date.now() - 60_000) throw invalid({ effectiveFrom: 'La nouvelle règle doit prendre effet maintenant ou plus tard.' });
    const id = uuidv7();
    try {
      await this.db.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext('fee_rules'))`.execute(trx);
        let q = trx.selectFrom('fee_rules').select(['id', 'effective_from']).where('effective_to', 'is', null);
        q = input.tripKind ? q.where('trip_kind', '=', input.tripKind) : q.where('trip_kind', 'is', null);
        const open = await q.forUpdate().executeTakeFirst();
        if (open) {
          if (open.effective_from.getTime() >= input.effectiveFrom.getTime()) {
            throw conflict('FEE_RULE_OVERLAP', 'Une version future existe déjà pour ce type de trajet.');
          }
          await trx.updateTable('fee_rules').set({ effective_to: input.effectiveFrom }).where('id', '=', open.id).execute();
        }
        await trx
          .insertInto('fee_rules')
          .values({
            id, effective_from: input.effectiveFrom, trip_kind: input.tripKind, commission_bps: input.commissionBps, commission_fixed_xof: input.commissionFixedXof,
            commission_min_xof: input.commissionMinXof, commission_max_xof: input.commissionMaxXof, service_fee_bps: input.serviceFeeBps,
            service_fee_fixed_xof: input.serviceFeeFixedXof, service_fee_min_xof: input.serviceFeeMinXof, service_fee_max_xof: input.serviceFeeMaxXof,
            created_by: staff.userId, is_demo: false,
          })
          .execute();
        await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'fee_rule.created', targetType: 'fee_rule', targetId: id, reason: input.reason,
                               changes: { ...input, effectiveFrom: input.effectiveFrom.toISOString(), closed: open?.id ?? null }, ctx }, trx);
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23P01') throw conflict('FEE_RULE_OVERLAP', 'Cette période chevauche une autre version pour ce type de trajet.');
      throw err;
    }
    return this.feeRules();
  }

  // ------------------------------------------------------------------ promotions

  private promoView(p: {
    id: string; code: string; description: string | null; discount_type: 'FIXED' | 'PERCENT'; discount_value: number; max_discount_xof: number | null; min_total_xof: number;
    starts_at: Date; ends_at: Date; max_redemptions: number | null; max_per_user: number; redemptions_count: number; first_trip_only: boolean; is_active: boolean; is_demo: boolean; created_at: Date;
  }) {
    return {
      id: p.id, code: p.code, description: p.description, discountType: p.discount_type,
      // Pourcentage exprimé en % pour l'écran (stocké en points de base).
      discountValue: p.discount_type === 'PERCENT' ? p.discount_value / 100 : p.discount_value,
      maxDiscountXof: p.max_discount_xof, minTotalXof: p.min_total_xof, startsAt: p.starts_at, endsAt: p.ends_at, maxRedemptions: p.max_redemptions,
      maxPerUser: p.max_per_user, redemptionsCount: p.redemptions_count, firstTripOnly: p.first_trip_only, isActive: p.is_active, isDemo: p.is_demo, createdAt: p.created_at,
    };
  }

  async promotions() {
    const rows = await this.db.selectFrom('promotions').selectAll().orderBy('created_at', 'desc').limit(200).execute();
    return { data: rows.map((p) => this.promoView(p)) };
  }

  async promotion(id: string) {
    const p = await this.db.selectFrom('promotions').selectAll().where('id', '=', id).executeTakeFirst();
    if (!p) throw notFound('Promotion');
    const usage = await this.db
      .selectFrom('promotion_redemptions')
      .select(['status', sql<number>`count(*)::int`.as('n'), sql<number>`coalesce(sum(amount_xof), 0)::bigint`.as('total')])
      .where('promotion_id', '=', id)
      .groupBy('status')
      .execute();
    return { ...this.promoView(p), usage: Object.fromEntries(usage.map((u) => [u.status, { count: u.n, amountXof: Number(u.total) }])) };
  }

  async createPromotion(
    staff: AuthContext,
    input: { code: string; description?: string; discountType: 'FIXED' | 'PERCENT'; discountValue: number; maxDiscountXof?: number | null; minTotalXof: number;
             startsAt: Date; endsAt: Date; maxRedemptions?: number | null; maxPerUser: number; firstTripOnly: boolean },
    ctx: RequestContext,
  ) {
    if (input.endsAt <= input.startsAt) throw invalid({ endsAt: 'La fin doit être après le début.' });
    if (input.discountType === 'PERCENT' && (input.discountValue <= 0 || input.discountValue > 100)) throw invalid({ discountValue: 'Pourcentage entre 1 et 100.' });
    const id = uuidv7();
    try {
      await this.db
        .insertInto('promotions')
        .values({
          id, code: input.code, description: input.description ?? null, discount_type: input.discountType,
          discount_value: input.discountType === 'PERCENT' ? Math.round(input.discountValue * 100) : input.discountValue,
          max_discount_xof: input.maxDiscountXof ?? null, min_total_xof: input.minTotalXof, starts_at: input.startsAt, ends_at: input.endsAt,
          max_redemptions: input.maxRedemptions ?? null, max_per_user: input.maxPerUser, first_trip_only: input.firstTripOnly, created_by: staff.userId,
        })
        .execute();
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('PROMO_CODE_TAKEN', 'Ce code existe déjà.');
      throw err;
    }
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'promotion.created', targetType: 'promotion', targetId: id, changes: { code: input.code, type: input.discountType, value: input.discountValue }, ctx });
    return this.promotion(id);
  }

  /** Une promotion déjà utilisée ne change pas de conditions de réduction : seulement sa fin, son plafond, son activation. */
  async updatePromotion(staff: AuthContext, id: string, input: { description?: string; endsAt?: Date; maxRedemptions?: number | null; isActive?: boolean }, ctx: RequestContext) {
    const p = await this.db.selectFrom('promotions').select(['id', 'starts_at', 'redemptions_count']).where('id', '=', id).executeTakeFirst();
    if (!p) throw notFound('Promotion');
    if (input.endsAt && input.endsAt <= p.starts_at) throw invalid({ endsAt: 'La fin doit être après le début.' });
    if (input.maxRedemptions != null && input.maxRedemptions < p.redemptions_count) throw invalid({ maxRedemptions: `Déjà ${p.redemptions_count} utilisations.` });
    await this.db
      .updateTable('promotions')
      .set({
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.endsAt ? { ends_at: input.endsAt } : {}),
        ...(input.maxRedemptions !== undefined ? { max_redemptions: input.maxRedemptions } : {}),
        ...(input.isActive !== undefined ? { is_active: input.isActive, deactivated_by: input.isActive ? null : staff.userId } : {}),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'promotion.updated', targetType: 'promotion', targetId: id, changes: { ...input }, ctx });
    return this.promotion(id);
  }

  // ------------------------------------------------------------------ référentiel des lieux

  async places(q: { q?: string; kind?: string; cursor?: string; limit: number }) {
    let query = this.db
      .selectFrom('places')
      .leftJoin('places as parent', 'parent.id', 'places.parent_id')
      .select(['places.id', 'places.kind', 'places.name', 'places.aliases', 'places.is_active', 'places.location_precision', 'parent.name as parent_name', 'places.parent_id',
               sql<number>`ST_Y(places.location::geometry)`.as('lat'), sql<number>`ST_X(places.location::geometry)`.as('lng')])
      .orderBy('places.id')
      .limit(q.limit + 1);
    if (q.q) query = query.where(sql<boolean>`places.search_text LIKE '%' || normalize_search(${q.q}) || '%'`);
    if (q.kind) query = query.where('places.kind', '=', q.kind as never);
    if (q.cursor) query = query.where('places.id', '>', q.cursor);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    return {
      data: page.map((p) => ({ id: p.id, kind: p.kind, name: p.name, aliases: p.aliases, isActive: p.is_active, precision: p.location_precision, parentId: p.parent_id, parentName: p.parent_name, lat: p.lat, lng: p.lng })),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    };
  }

  async createPlace(staff: AuthContext, input: { kind: 'CITY' | 'COMMUNE' | 'NEIGHBORHOOD' | 'LANDMARK' | 'STATION'; name: string; parentId?: string; aliases: string[]; lat: number; lng: number; precision: 'EXACT' | 'APPROX' }, ctx: RequestContext) {
    const id = uuidv7();
    try {
      await sql`INSERT INTO places (id, kind, name, parent_id, aliases, location, location_precision)
                VALUES (${id}, ${input.kind}, ${input.name}, ${input.parentId ?? null}, ${input.aliases}, ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography, ${input.precision})`.execute(this.db);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') throw conflict('PLACE_EXISTS', 'Un lieu porte déjà ce nom à cet endroit.');
      if (code === '23503') throw invalid({ parentId: 'Lieu parent introuvable.' });
      throw err;
    }
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'place.created', targetType: 'place', targetId: id, changes: { name: input.name, kind: input.kind }, ctx });
    return this.place(id);
  }

  async place(id: string) {
    const p = await this.db
      .selectFrom('places')
      .select(['id', 'kind', 'name', 'aliases', 'is_active', 'parent_id', 'location_precision', sql<number>`ST_Y(location::geometry)`.as('lat'), sql<number>`ST_X(location::geometry)`.as('lng')])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!p) throw notFound('Lieu');
    return { id: p.id, kind: p.kind, name: p.name, aliases: p.aliases, isActive: p.is_active, parentId: p.parent_id, precision: p.location_precision, lat: p.lat, lng: p.lng };
  }

  async updatePlace(staff: AuthContext, id: string, input: { name?: string; aliases?: string[]; isActive?: boolean; lat?: number; lng?: number; precision?: 'EXACT' | 'APPROX' }, ctx: RequestContext) {
    const exists = await this.db.selectFrom('places').select('id').where('id', '=', id).executeTakeFirst();
    if (!exists) throw notFound('Lieu');
    if ((input.lat === undefined) !== (input.lng === undefined)) throw invalid({ lat: 'Latitude et longitude vont ensemble.' });
    await this.db
      .updateTable('places')
      .set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.aliases ? { aliases: input.aliases } : {}),
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        ...(input.precision ? { location_precision: input.precision } : {}),
        ...(input.lat !== undefined ? { location: sql<string>`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography` } : {}),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'place.updated', targetType: 'place', targetId: id, changes: { ...input }, ctx });
    return this.place(id);
  }

  // ------------------------------------------------------------------ tableau de bord et statistiques

  async dashboard(from: Date, to: Date) {
    const one = async <T>(q: Promise<T>) => q;
    const [users, drivers, trips, bookings, money, refunds, queues] = await Promise.all([
      one(sql<{ total: number; created: number }>`SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM staff_accounts s WHERE s.user_id = u.id))::int AS total,
                     count(*) FILTER (WHERE created_at >= ${from} AND created_at < ${to} AND NOT EXISTS (SELECT 1 FROM staff_accounts s WHERE s.user_id = u.id))::int AS created
                FROM users u WHERE status <> 'DELETED'`.execute(this.db)),
      one(sql<{ verified: number; pending: number }>`SELECT count(*) FILTER (WHERE verification_status = 'APPROVED')::int AS verified,
                     count(*) FILTER (WHERE verification_status = 'PENDING')::int AS pending FROM driver_profiles`.execute(this.db)),
      one(sql<{ published: number; completed: number; cancelled: number }>`SELECT count(*) FILTER (WHERE published_at >= ${from} AND published_at < ${to})::int AS published,
                     count(*) FILTER (WHERE completed_at >= ${from} AND completed_at < ${to})::int AS completed,
                     count(*) FILTER (WHERE cancelled_at >= ${from} AND cancelled_at < ${to})::int AS cancelled FROM trips`.execute(this.db)),
      one(sql<{ created: number; confirmed: number; seats: number }>`SELECT count(*)::int AS created,
                     count(*) FILTER (WHERE confirmed_at IS NOT NULL)::int AS confirmed,
                     coalesce(sum(seats) FILTER (WHERE confirmed_at IS NOT NULL), 0)::int AS seats
                FROM bookings WHERE created_at >= ${from} AND created_at < ${to}`.execute(this.db)),
      one(sql<{ paid: number; payments: number; commission: number; fees: number; discounts: number }>`SELECT coalesce(sum(p.amount_xof), 0)::bigint AS paid, count(*)::int AS payments,
                     coalesce(sum(b.commission_xof), 0)::bigint AS commission, coalesce(sum(b.service_fee_xof), 0)::bigint AS fees, coalesce(sum(b.discount_xof), 0)::bigint AS discounts
                FROM payments p JOIN bookings b ON b.id = p.booking_id
               WHERE p.status = 'SUCCEEDED' AND p.succeeded_at >= ${from} AND p.succeeded_at < ${to}`.execute(this.db)),
      one(sql<{ amount: number; count: number }>`SELECT coalesce(sum(amount_xof), 0)::bigint AS amount, count(*)::int AS count FROM refunds
               WHERE status = 'SUCCEEDED' AND succeeded_at >= ${from} AND succeeded_at < ${to}`.execute(this.db)),
      one(sql<{ disputes: number; reports_urgent: number; reports_open: number; vehicles_pending: number; refunds_to_approve: number; refunds_manual: number; reconciliation_open: number; payment_alerts: number }>`
        SELECT (SELECT count(*)::int FROM disputes WHERE status IN ('OPEN','AWAITING_RESPONSE','IN_REVIEW')) AS disputes,
               (SELECT count(*)::int FROM reports WHERE status IN ('OPEN','IN_REVIEW') AND severity IN ('HIGH','CRITICAL')) AS reports_urgent,
               (SELECT count(*)::int FROM reports WHERE status IN ('OPEN','IN_REVIEW')) AS reports_open,
               (SELECT count(*)::int FROM vehicles WHERE verification_status = 'PENDING' AND deleted_at IS NULL) AS vehicles_pending,
               (SELECT count(*)::int FROM refunds WHERE status = 'REQUESTED') AS refunds_to_approve,
               (SELECT count(*)::int FROM refunds WHERE status IN ('MANUAL_REQUIRED','FAILED') AND NOT EXISTS (
                   SELECT 1 FROM refunds r2 WHERE r2.booking_id = refunds.booking_id AND r2.status = 'SUCCEEDED')) AS refunds_manual,
               (SELECT count(*)::int FROM reconciliation_items WHERE resolved_at IS NULL) AS reconciliation_open,
               (SELECT count(*)::int FROM payment_events WHERE processing_result IN ('MISMATCH','REJECTED') AND received_at >= now() - interval '7 days') AS payment_alerts`.execute(this.db)),
    ]);
    const q = queues.rows[0]!;
    const alerts: { level: 'danger' | 'warning'; code: string; text: string; count: number; link: string }[] = [];
    if (q.reports_urgent > 0) alerts.push({ level: 'danger', code: 'REPORTS_URGENT', text: 'Signalements graves à traiter', count: q.reports_urgent, link: '/admin/signalements' });
    if (q.reconciliation_open > 0) alerts.push({ level: 'danger', code: 'RECONCILIATION', text: 'Écarts de rapprochement non résolus', count: q.reconciliation_open, link: '/admin/finance/rapprochement' });
    if (q.payment_alerts > 0) alerts.push({ level: 'warning', code: 'PAYMENT_EVENTS', text: 'Événements de paiement refusés ou en écart (7 jours)', count: q.payment_alerts, link: '/admin/paiements' });
    if (q.refunds_manual > 0) alerts.push({ level: 'warning', code: 'REFUNDS_MANUAL', text: 'Remboursements à traiter à la main', count: q.refunds_manual, link: '/admin/finance/remboursements' });
    if (q.refunds_to_approve > 0) alerts.push({ level: 'warning', code: 'REFUNDS_APPROVAL', text: 'Remboursements en attente de validation', count: q.refunds_to_approve, link: '/admin/finance/remboursements' });
    const m = money.rows[0]!;
    const r = refunds.rows[0]!;
    return {
      period: { from, to },
      users: users.rows[0],
      drivers: drivers.rows[0],
      trips: trips.rows[0],
      bookings: bookings.rows[0],
      money: { paidXof: Number(m.paid), payments: m.payments, commissionXof: Number(m.commission), serviceFeesXof: Number(m.fees), discountsXof: Number(m.discounts), refundedXof: Number(r.amount), refunds: r.count },
      queues: {
        disputesOpen: q.disputes, reportsOpen: q.reports_open, reportsUrgent: q.reports_urgent, driversPending: drivers.rows[0]!.pending, vehiclesPending: q.vehicles_pending,
        refundsToApprove: q.refunds_to_approve, refundsManual: q.refunds_manual, reconciliationOpen: q.reconciliation_open,
      },
      alerts,
    };
  }

  /** Statistiques (EF-98) par ville de départ, axe, période ou type de trajet ; réservations confirmées seulement. */
  async stats(q: { groupBy: 'city' | 'route' | 'period' | 'kind'; from: Date; to: Date; interval: 'day' | 'week' | 'month' }) {
    const key = {
      city: sql<string>`coalesce(CASE WHEN p0.kind = 'CITY' THEN p0.name END, CASE WHEN p1.kind = 'CITY' THEN p1.name END, p2.name, o.label)`,
      route: sql<string>`o.label || ' → ' || d.label`,
      period: sql<string>`to_char(date_trunc(${q.interval}, b.confirmed_at AT TIME ZONE 'Africa/Abidjan'), 'YYYY-MM-DD')`,
      kind: sql<string>`t.kind::text`,
    }[q.groupBy];
    const rows = await sql<{ key: string; bookings: number; seats: number; trips: number; paid: number; commission: number }>`
      SELECT ${key} AS key, count(*)::int AS bookings, sum(b.seats)::int AS seats, count(DISTINCT t.id)::int AS trips,
             coalesce(sum(b.total_xof) FILTER (WHERE b.payment_status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED','REFUND_PENDING')), 0)::bigint AS paid,
             coalesce(sum(b.commission_xof) FILTER (WHERE b.payment_status IN ('PAID','PARTIALLY_REFUNDED')), 0)::bigint AS commission
        FROM bookings b
        JOIN trips t ON t.id = b.trip_id
        JOIN trip_stops o ON o.trip_id = t.id AND o.seq = (SELECT min(seq) FROM trip_stops WHERE trip_id = t.id)
        JOIN trip_stops d ON d.trip_id = t.id AND d.seq = (SELECT max(seq) FROM trip_stops WHERE trip_id = t.id)
        LEFT JOIN places p0 ON p0.id = o.place_id
        LEFT JOIN places p1 ON p1.id = p0.parent_id
        LEFT JOIN places p2 ON p2.id = p1.parent_id AND p2.kind = 'CITY'
       WHERE b.confirmed_at >= ${q.from} AND b.confirmed_at < ${q.to}
       GROUP BY 1
       ORDER BY ${q.groupBy === 'period' ? sql`1` : sql`2 DESC`}
       LIMIT 200`.execute(this.db);
    return {
      groupBy: q.groupBy,
      period: { from: q.from, to: q.to },
      data: rows.rows.map((r) => ({ key: r.key, bookings: r.bookings, seats: r.seats, trips: r.trips, paidXof: Number(r.paid), commissionXof: Number(r.commission) })),
    };
  }
}
