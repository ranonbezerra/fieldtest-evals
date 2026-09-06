import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// ASSUMPTION: Prisma models are named `Account` and `Transfer` in the schema,
// exposing `this.prisma.account` and `this.prisma.transfer` on the client.
// Field names use camelCase in the schema (mapped to snake_case via @map).

@Injectable()
export class AccountsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAccountById(id: string) {
    return this.prisma.account.findUnique({ where: { id } });
  }

  // ASSUMPTION: A transfer is linked to an account via `fromAccountId` or
  // `toAccountId` fields. Adjust if the schema uses different field names.
  async findTransfersForAccount(accountId: string) {
    return this.prisma.transfer.findMany({
      where: {
        OR: [
          { fromAccountId: accountId },
          { toAccountId: accountId },
        ],
      },
    });
  }
}
