import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { RateLimitService } from '../../infra/rate-limit.service';
import { REDIS } from '../../infra/redis.module';
import { detectMime, StorageService } from '../../infra/storage.service';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PENDING_TTL_S = 600;

interface PendingPhoto {
  key: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** Photo de profil : même parcours que les documents (URL signée, contrôle du fichier reçu), sans table dédiée. */
@Injectable()
export class PhotoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly storage: StorageService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  async createUpload(userId: string, input: { mimeType: string; sizeBytes: number; sha256: string }) {
    await this.rateLimit.consumeOrThrow([{ key: `photo-upload:${userId}`, limit: 10, windowS: 3600 }], 'Trop de changements de photo. Réessayez plus tard.');
    const pending: PendingPhoto = { key: `photos/${userId}/${uuidv7()}`, ...input };
    const upload = await this.storage.presignPut(pending.key, input.mimeType, input.sizeBytes);
    await this.redis.set(`photo:pending:${userId}`, JSON.stringify(pending), 'EX', PENDING_TTL_S);
    return { upload };
  }

  async complete(userId: string, ctx: RequestContext): Promise<void> {
    const raw = await this.redis.get(`photo:pending:${userId}`);
    if (!raw) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'UPLOAD_MISSING', 'Aucun dépôt de photo en cours. Recommencez.');
    const pending = JSON.parse(raw) as PendingPhoto;
    const content = await this.storage.read(pending.key, MAX_PHOTO_BYTES);
    if (!content) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'UPLOAD_MISSING', 'La photo n’a pas été reçue. Recommencez.');
    const ok =
      content.length === pending.sizeBytes &&
      createHash('sha256').update(content).digest('hex') === pending.sha256 &&
      detectMime(content) === pending.mimeType;
    if (!ok) {
      await this.storage.remove(pending.key);
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'UPLOAD_INVALID', 'Le fichier reçu n’est pas l’image annoncée.');
    }
    const previous = await this.db.selectFrom('users').select('photo_object_key').where('id', '=', userId).executeTakeFirst();
    await this.db.updateTable('users').set({ photo_object_key: pending.key }).where('id', '=', userId).execute();
    await this.redis.del(`photo:pending:${userId}`);
    if (previous?.photo_object_key) await this.storage.remove(previous.photo_object_key);
    await this.audit.log({ actorId: userId, action: 'user.photo_update', targetType: 'user', targetId: userId, ctx });
  }

  async remove(userId: string, ctx: RequestContext): Promise<void> {
    const row = await this.db.selectFrom('users').select('photo_object_key').where('id', '=', userId).executeTakeFirst();
    if (!row?.photo_object_key) return;
    await this.db.updateTable('users').set({ photo_object_key: null }).where('id', '=', userId).execute();
    await this.storage.remove(row.photo_object_key);
    await this.audit.log({ actorId: userId, action: 'user.photo_delete', targetType: 'user', targetId: userId, ctx });
  }
}
