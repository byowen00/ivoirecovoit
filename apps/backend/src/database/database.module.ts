import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import { ENV, type Env } from '../config/env';
import type { Database } from './types';

// int8 (bigint) : les montants XOF tiennent largement dans un entier JS sûr ; au-delà on refuse.
types.setTypeParser(20, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Entier hors limites : ${value}`);
  return n;
});

// date : gardée en chaîne AAAA-MM-JJ (pas de décalage de fuseau) ; numeric (notes moyennes) : nombre.
types.setTypeParser(1082, (value: string) => value);
types.setTypeParser(1700, (value: string) => Number(value));

export const DB = Symbol('DB');
export type Db = Kysely<Database>;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env): Db =>
        new Kysely<Database>({
          dialect: new PostgresDialect({
            pool: new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX }),
          }),
        }),
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
