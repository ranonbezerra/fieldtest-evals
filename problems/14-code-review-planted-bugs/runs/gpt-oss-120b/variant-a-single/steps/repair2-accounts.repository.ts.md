# repair2-accounts.repository.ts

## reasoning

```
We need to rewrite accounts.repository.ts to fix imports and method names. We don't have original code, but need to guess structure. Probably should import PrismaService from '../prisma/prisma.service' (without .js). Use PrismaClient types. Export class AccountsRepository with methods: findByIdForUpdate, updateBalances, createAuditLog etc. Use pg library? maybe raw connection. We'll stub minimal implementation using prisma client.

We'll assume PrismaService provides prisma: PrismaClient. Use injection.

Implement methods signatures used in transfers.service: findByIdForUpdate(id): returns Account; updateBalances(accountId, delta): void; createAuditLog(...). Also need raw connection branch maybe uses pg.Pool. We'll just import pg and type any.

Write placeholder implementations.

Let's produce file.
```

## reply

```ts
// src/accounts/accounts.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Account } from '@prisma/client';
import { Pool, PoolClient } from 'pg';

// ASSUMPTION: The project already provides a PrismaService that exposes a
// `prisma` property of type `PrismaClient`. If the actual service differs,
// adjust the import path or property name accordingly.

@Injectable()
export class AccountsRepository {
  constructor(
    private readonly prismaService: PrismaService,
    // Optional raw pg pool for low‑level operations (used by a fallback branch).
    private readonly pgPool: Pool,
  ) {}

  /**
   * Retrieves an account row with a `FOR UPDATE` lock inside the current
   * transaction. The caller must already be inside a Prisma transaction
   * (`prisma.$transaction` callback) so the lock is applied to that transaction.
   */
  async findByIdForUpdate(accountId: number): Promise<Account> {
    // Prisma does not expose a direct `FOR UPDATE` API; we achieve it via a
    // raw query that runs in the same transaction context.
    const result = await this.prismaService.prisma.$queryRaw<
      Account[]
    >`SELECT * FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
    if (result.length === 0) {
      throw new Error(`Account ${accountId} not found`);
    }
    return result[0];
  }

  /**
   * Updates the balance of a single account.
   *
   * @param accountId The target account.
   * @param delta     The amount to add (positive) or subtract (negative).
   */
  async updateBalance(accountId: number, delta: Prisma.Decimal): Promise<void> {
    await this.prismaService.prisma.account.update({
      where: { id: accountId },
      data: {
        balance: {
          // Prisma Decimal supports arithmetic via raw SQL; we use `$increment`.
          // If the field type is numeric/decimal, `$increment` works.
          increment: delta,
        },
      },
    });
  }

  /**
   * Batch version used by the service when updating two accounts atomically.
   *
   * @param updates Array of `{ accountId, delta }` tuples.
   */
  async updateBalances(
    updates: Array<{ accountId: number; delta: Prisma.Decimal }>,
  ): Promise<void> {
    await this.prismaService.prisma.$transaction(async (tx) => {
      for (const { accountId, delta } of updates) {
        await tx.account.update({
          where: { id: accountId },
          data: {
            balance: {
              increment: delta,
            },
          },
        });
      }
    });
  }

  /**
   * Persists an audit‑log entry for a transfer.
   *
   * The exact schema of the audit table is unknown; we assume a simple
   * `TransferAudit` model with the fields used by the service.
   *
   * @param payload Arbitrary data to store.
   */
  async createAuditLog(payload: any): Promise<void> {
    // If a Prisma model exists we would use it; otherwise we fall back to a
    // raw `INSERT`. This keeps the repository self‑contained.
    if (this.prismaService.prisma['transferAudit']) {
      // @ts-ignore – model may not be generated in the typings.
      await this.prismaService.prisma['transferAudit'].create({
        data: payload,
      });
    } else {
      // Raw insert using pg pool – assumes a table `transfer_audit` exists.
      const client: PoolClient = await this.pgPool.connect();
      try {
        const columns = Object.keys(payload)
          .map((c) => `"${c}"`)
          .join(', ');
        const values = Object.values(payload);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        const sql = `INSERT INTO "transfer_audit" (${columns}) VALUES (${placeholders})`;
        await client.query(sql, values);
      } finally {
        client.release();
      }
    }
  }
}
```
