import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
// ASSUMPTION: @prisma/client exports (PrismaClient, Prisma) are only available after running `prisma generate`.

@Injectable()
export class AccountsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getAccount(id: string) {
    return this.prisma.account.findUnique({ where: { id } });
  }

  async lockAccount(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRawUnsafe(
      'SELECT * FROM "accounts" WHERE id = $1 FOR UPDATE',
      id,
    );
    return (rows as unknown[])[0] ?? null;
  }

  async applyDebit(id: string, amount: number, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.account.update({
      where: { id },
      data: { balance: { decrement: amount } },
    });
  }

  async applyCredit(id: string, amount: number, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.account.update({
      where: { id },
      data: { balance: { increment: amount } },
    });
  }

  async fetchRawBalances(ids: string[]) {
    return this.prisma.$queryRawUnsafe(
      'SELECT id, balance FROM "accounts" WHERE id = ANY($1)',
      ids,
    );
  }
}
