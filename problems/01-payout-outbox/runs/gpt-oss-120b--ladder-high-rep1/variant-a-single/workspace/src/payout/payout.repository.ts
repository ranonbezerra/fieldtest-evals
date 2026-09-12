import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma, PayoutStatus } from '@prisma/client';
import { InsufficientFundsError } from './errors.js';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPayoutByIdempotencyKey(key: string) {
    return this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
  }

  async createPayoutAndReserve(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }) {
    const { accountId, amount, destinationAddress, idempotencyKey } = params;

    return await this.prisma.$transaction(async (tx) => {
      // Idempotency check
      const existing = await tx.payout.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return { payout: existing, created: false };
      }

      // Atomic reservation
      const rows = await tx.$executeRaw<
        Prisma.Sql
      >`UPDATE "Account" SET "availableBalance" = "availableBalance" - ${amount},
         "updatedAt" = now()
         WHERE "id" = ${accountId}
           AND "availableBalance" >= ${amount}`;
      if (Number(rows) === 0) {
        throw new InsufficientFundsError();
      }

      // Create payout record
      const payout = await tx.payout.create({
        data: {
          accountId: Number(accountId),
          amount,
          destinationAddress,
          idempotencyKey,
          status: PayoutStatus.CREATED,
        },
      });

      // Queue message atomically
      await tx.message.create({
        data: {
          type: 'PAYOUT',
          payload: { payoutId: payout.id },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return { payout, created: true };
    });
  }

  async fetchPendingMessages(limit: number) {
    return this.prisma.message.findMany({
      where: { type: 'PAYOUT' },
      take: limit,
    });
  }

  async claimMessage(messageId: number) {
    const result = await this.prisma.message.updateMany({
      where: { id: messageId, processedAt: null },
      data: { processedAt: new Date() },
    });
    return result.count > 0;
  }

  async markMessageDone(messageId: number) {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { processedAt: new Date() },
    });
  }

  async resetMessageToPending(messageId: number) {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { processedAt: null },
    });
  }

  async getPayoutById(payoutId: number) {
    return this.prisma.payout.findUnique({ where: { id: payoutId } });
  }

  async incrementPayoutAttempts(payoutId: number) {
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: { attempts: { increment: 1 } },
    });
  }

  async updatePayoutStatus(
    payoutId: number,
    status: PayoutStatus,
    txHash?: string,
  ) {
    const data: any = { status };
    if (txHash) data.providerTxHash = txHash;
    return this.prisma.payout.update({
      where: { id: payoutId },
      data,
    });
  }

  async settlePayout(payoutId: number) {
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });

      // Adjust balances atomically
      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          balance: { decrement: payout.amount },
          availableBalance: { increment: payout.amount },
        },
      });

      // Final status
      await tx.payout.update({
        where: { id: payoutId },
        data: { status: PayoutStatus.COMPLETED },
      });
    });
  }

  async markPayoutNeedsReview(payoutId: number) {
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: { status: PayoutStatus.NEEDS_REVIEW },
    });
  }
}
