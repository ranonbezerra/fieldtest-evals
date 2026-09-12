import { Global, Module } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../drizzle/schema.js';

export const DB = Symbol('DB');
export type Db = NodePgDatabase<typeof schema>;

/**
 * `@Global()`, so a module that needs the database injects `DB` without
 * importing this module. Nothing else in the application is global.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db => {
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
