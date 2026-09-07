// ASSUMPTION: @nestjs/common is not resolvable in the current environment; the import is correct per the plan and should resolve once dependencies are installed.
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DB } from '../db/database.module.js';
import type { DrizzleDb } from '../db/client.js';
import { accounts, type AccountRow, type AccountInsert } from '../db/schema.js';

@Injectable()
export class AccountsRepository {
  constructor(@Inject(DB) private db: DrizzleDb) {}

  async findById(id: string): Promise<AccountRow | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findAll(): Promise<AccountRow[]> {
    return this.db.select().from(accounts);
  }

  async create(input: AccountInsert): Promise<AccountRow> {
    const [row] = await this.db
      .insert(accounts)
      .values({ ...input, id: randomUUID() })
      .returning();
    return row;
  }
}
