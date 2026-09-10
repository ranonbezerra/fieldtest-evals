import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma, PayoutStatus, MessageStatus } from '@prisma/client';

// ASSUMPTION: ../prisma/prisma.service does not exist; using PrismaClient directly from @prisma/client.

export type CreatePayoutResult =
  | { status: 'created'; payoutId: string }
  | { status: 'already_exists'; payoutId: string }
  | { status: 'account_not_found' }
  | { status: 'insufficient_funds' };

export interface PendingMessage {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPayout(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<CreatePayoutResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.payout.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: params.accountId,
            idempotencyKey: params.idempotencyKey,
          },
        },
      });
      if (existing) {
        return { status: 'already_exists', payoutId: existing.id };
      }

      const locked = await tx.$queryRaw<
        Array<{ settled_balance: bigint; reserved_balance: bigint }>
      >(
        Prisma.sql`SELECT settled_balance, reserved_balance FROM "account" WHERE id = ${params.accountId} FOR UPDATE`,
      );

      if (locked.length === 0) {
        return { status: 'account_not_found' };
      }

      const { settled_balance: settled, reserved_balance: reserved } = locked[0];
      const available = settled - reserved;

      if (available < params.amount) {
        return { status: 'insufficient_funds' };
      }

      await tx.account.update({
        where: { id: params.accountId },
        data: {
          settledBalance: { decrement: params.amount },
          reservedBalance: { increment: params.amount },
        },
      });

      const payout = await tx.payout.create({
        data: {
          accountId: params.accountId,
          idempotencyKey: params.idempotencyKey,
          amount: params.amount,
          destinationAddress: params.destinationAddress,
          status: PayoutStatus.created,
        },
      });

      await tx.message.create({
        data: {
          type: 'process_payout',
          payload: { payoutId: payout.id },
          status: MessageStatus.pending,
        },
      });

      return { status: 'created', payoutId: payout.id };
    });
  }

  async getDueMessages(): Promise<PendingMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: {
        status: MessageStatus.pending,
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map((m) => ({
      id: m.id,
      type: m.type,
      payload: m.payload,
      attempts: m.attempts,
    }));
  }

  async markMessageProcessing(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status: MessageStatus.processing },
    });
  }

  async markMessageProcessed(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: {
        status: MessageStatus.processed,
        processedAt: new Date(),
      },
    });
  }

  async incrementMessageAttempts(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        status: MessageStatus.pending,
        nextAttemptAt: new Date(Date.now() + 5_000),
      },
    });
  }

  async updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string): Promise<void> {
    const data: Record<string, unknown> = { status };
    if (txHash) data.txHash = txHash;
    if (status === PayoutStatus.completed || status === PayoutStatus.failed) {
      data.completedAt = new Date();
    }
    await this.prisma.payout.update({ where: { id }, data });
  }

  async settlePayout(payoutId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
        include: { account: true },
      });

      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.completed,
          txHash,
          completedAt: new Date(),
        },
      });

      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          reservedBalance: { decrement: payout.amount },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          payoutId,
          kind: 'settlement',
          lines: {
            create: [
              {
                accountName: 'account',
                accountId: payout.accountId,
                direction: 'debit',
                amount: payout.amount,
              },
              {
                accountName: 'payouts',
                direction: 'credit',
                amount: payout.amount,
              },
            ],
          },
        },
      });
    });
  }

  async releaseReservation(payoutId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
        include: { account: true },
      });

      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.failed,
          completedAt: new Date(),
        },
      });

      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          reservedBalance: { decrement: payout.amount },
          settledBalance: { increment: payout.amount },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          payoutId,
          kind: 'reversal',
          lines: {
            create: [
              {
                accountName: 'account',
                accountId: payout.accountId,
                direction: 'credit',
                amount: payout.amount,
              },
              {
                accountName: 'payouts',
                direction: 'debit',
                amount: payout.amount,
              },
            ],
          },
        },
      });
    });
  }

  async markNeedsReview(payoutId: string, txHash?: string): Promise<void> {
    const data: Record<string, unknown> = {
      status: PayoutStatus.needs_review,
      completedAt: new Date(),
    };
    if (txHash) data.txHash = txHash;
    await this.prisma.payout.update({ where: { id: payoutId }, data });
  }

  async findPayoutById(id: string) {
    return this.prisma.payout.findUnique({
      where: { id },
      include: { account: true },
    });
  }

  async createAccount(id: string, settledBalance?: bigint) {
    return this.prisma.account.create({
      data: {
        id,
        settledBalance: settledBalance ?? 0n,
      },
    });
  }

  async getAccount(id: string) {
    return this.prisma.account.findUnique({
      where: { id },
    });
  }
}
