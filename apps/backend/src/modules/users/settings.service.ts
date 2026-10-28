import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db } from '../../database/database.module';

/** Lecture des paramètres versionnés (dernière version de chaque clé). */
@Injectable()
export class SettingsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async get<T>(key: string): Promise<T | undefined> {
    const row = await this.db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', key)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.value as T | undefined;
  }

  async legalVersions(): Promise<{ TERMS: string; PRIVACY: string }> {
    const [terms, privacy] = await Promise.all([
      this.get<string>('legal.terms_version'),
      this.get<string>('legal.privacy_version'),
    ]);
    if (!terms || !privacy) throw new Error('Paramètres legal.* absents : lancer db:seed');
    return { TERMS: terms, PRIVACY: privacy };
  }
}
