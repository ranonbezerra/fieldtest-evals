// accounts.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { Pool, PoolClient } from 'pg';

export interface AccountRow {
  id: string;
  balance: bigint;
  currency: string;
}

@Injectable()
export class AccountsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: Pool,
  ) {}

  /**
   * Locks the account row for the duration of the surrounding transaction.
   * Callers must be inside prisma.$transaction.
   */
  async lockAccount(tx: Tx, accountId: string): Promise<AccountRow> {
    const rows = await tx.$queryRaw<AccountRow[]>`
      SELECT id, balance, currency
      FROM "Account"
      WHERE id = ${accountId}
      FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new Error(`account not found: ${accountId}`);
    }
    return rows[0];
  }

  /** Raw client for streaming/export use cases that bypass Prisma. */
  async getRawClient(): Promise<PoolClient> {
    return this.pool.connect();
  }
}
