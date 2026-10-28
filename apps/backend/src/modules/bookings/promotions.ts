import { HttpStatus } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { ApiError } from '../../common/api-error';
import type { Db } from '../../database/database.module';
import type { Database } from '../../database/types';
import type { PromotionTerms } from './amounts';

const invalid = (message: string) => new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'PROMO_INVALID', message);

export interface ApplicablePromotion extends PromotionTerms {
  id: string;
  code: string;
}

/**
 * Code promo applicable à cette réservation (doc 05 §10) : actif, dans ses dates, montant minimum atteint,
 * limite par personne, « première course » si configuré, et encore des utilisations disponibles.
 * Le compteur global est réservé à part (`reservePromotion`) pour rester exact sous concurrence.
 */
export async function findPromotion(
  trx: Db | Transaction<Database>,
  userId: string,
  code: string,
  totalBeforeDiscountXof: number,
  now = new Date(),
): Promise<ApplicablePromotion> {
  const p = await trx
    .selectFrom('promotions')
    .select(['id', 'code', 'discount_type', 'discount_value', 'max_discount_xof', 'min_total_xof', 'starts_at', 'ends_at', 'max_redemptions',
             'redemptions_count', 'max_per_user', 'first_trip_only', 'is_active'])
    .where(sql<boolean>`code = ${code}::citext`)
    .executeTakeFirst();
  if (!p || !p.is_active) throw invalid('Ce code promo n’existe pas ou n’est plus actif.');
  if (now < p.starts_at) throw invalid('Ce code promo n’est pas encore valable.');
  if (now >= p.ends_at) throw invalid('Ce code promo a expiré.');
  if (totalBeforeDiscountXof < p.min_total_xof) throw invalid(`Ce code promo s’applique à partir de ${p.min_total_xof} F CFA.`);
  if (p.max_redemptions !== null && p.redemptions_count >= p.max_redemptions) throw invalid('Ce code promo a déjà été entièrement utilisé.');
  const used = await trx
    .selectFrom('promotion_redemptions')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('promotion_id', '=', p.id)
    .where('user_id', '=', userId)
    .where('status', 'in', ['RESERVED', 'USED'])
    .executeTakeFirstOrThrow();
  if (used.n >= p.max_per_user) throw invalid('Vous avez déjà utilisé ce code promo.');
  if (p.first_trip_only) {
    const done = await trx
      .selectFrom('bookings')
      .select('id')
      .where('passenger_id', '=', userId)
      .where('status', 'in', ['CONFIRMED', 'COMPLETED', 'NO_SHOW'])
      .limit(1)
      .executeTakeFirst();
    if (done) throw invalid('Ce code promo est réservé à un premier trajet.');
  }
  return { id: p.id, code: p.code, discount_type: p.discount_type, discount_value: p.discount_value, max_discount_xof: p.max_discount_xof };
}

/** Réserve une utilisation : 0 ligne modifiée = plus d'utilisation disponible (doc 05 §3, étape 5). */
export async function reservePromotion(trx: Transaction<Database>, promotionId: string): Promise<void> {
  const r = await trx
    .updateTable('promotions')
    .set({ redemptions_count: sql<number>`redemptions_count + 1` })
    .where('id', '=', promotionId)
    .where((eb) => eb.or([eb('max_redemptions', 'is', null), eb('redemptions_count', '<', eb.ref('max_redemptions'))]))
    .executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw invalid('Ce code promo a déjà été entièrement utilisé.');
}
