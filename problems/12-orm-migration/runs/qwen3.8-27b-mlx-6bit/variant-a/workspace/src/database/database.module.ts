// ASSUMPTION: The compiler errors are all in test/invoice.spec.ts and concern the
// Vitest assertion type (expect() return value). None of them name or require a
// change in this file. The content below is the plan-specified implementation as-is.

import { Module } from '@nestjs/common';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

export const DRIZZLE = Symbol('drizzle');
export type DrizzleDb = PostgresJsDatabase<typeof schema>;

@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): DrizzleDb => {
        const client = postgres(process.env.DATABASE_URL!);
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
