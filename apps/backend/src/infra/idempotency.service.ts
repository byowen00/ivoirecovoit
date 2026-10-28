import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { ApiError } from '../common/api-error';
import { DB, type Db } from '../database/database.module';

const keySchema = z.uuid();

/** Durée pendant laquelle une requête en cours bloque son propre rejeu. */
const LOCK_S = 30;

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/** Valide l'en-tête Idempotency-Key (UUID obligatoire sur les routes marquées 🔁). */
export function requireIdempotencyKey(header: string | undefined): string {
  const parsed = keySchema.safeParse(header);
  if (!parsed.success) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'IDEMPOTENCY_KEY_REQUIRED',
      'En-tête Idempotency-Key (UUID) obligatoire pour cette opération.',
    );
  }
  return parsed.data;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Idempotence des créations : une même clé renvoie la réponse enregistrée sans rejouer l'opération ;
 * une clé réutilisée avec une autre requête est refusée. Seuls les succès sont mémorisés : après une erreur,
 * la même clé peut être rejouée.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async run<T>(
    userId: string,
    key: string,
    endpoint: string,
    request: unknown,
    status: number,
    fn: () => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const hash = createHash('sha256').update(`${endpoint}\n${stableStringify(request)}`).digest();
    const inserted = await this.db
      .insertInto('idempotency_keys')
      .values({
        key,
        user_id: userId,
        endpoint,
        request_hash: hash,
        response_body: null,
        response_code: null,
        locked_until: sql<Date>`now() + make_interval(secs => ${LOCK_S})`,
      })
      .onConflict((oc) => oc.columns(['user_id', 'key']).doNothing())
      .returning('key')
      .executeTakeFirst();

    if (!inserted) {
      const row = await this.db
        .selectFrom('idempotency_keys')
        .select(['endpoint', 'request_hash', 'response_code', 'response_body', 'locked_until'])
        .where('user_id', '=', userId)
        .where('key', '=', key)
        .executeTakeFirstOrThrow();
      if (row.endpoint !== endpoint || !row.request_hash.equals(hash)) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'IDEMPOTENCY_KEY_REUSED',
          'Cette clé a déjà servi pour une autre requête.',
        );
      }
      if (row.response_code !== null) {
        return { status: row.response_code, body: row.response_body as T, replayed: true };
      }
      throw new ApiError(HttpStatus.CONFLICT, 'REQUEST_IN_PROGRESS', 'Cette opération est déjà en cours de traitement.');
    }

    try {
      const body = await fn();
      await this.db
        .updateTable('idempotency_keys')
        .set({ response_code: status, response_body: JSON.stringify(body), locked_until: null })
        .where('user_id', '=', userId)
        .where('key', '=', key)
        .execute();
      return { status, body, replayed: false };
    } catch (err) {
      await this.db.deleteFrom('idempotency_keys').where('user_id', '=', userId).where('key', '=', key).execute();
      throw err;
    }
  }
}
