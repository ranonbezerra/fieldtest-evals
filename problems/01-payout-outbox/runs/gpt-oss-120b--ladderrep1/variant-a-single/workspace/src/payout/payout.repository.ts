import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  Payout,
  Prisma,
  OutboxMessage,
  MessageStatus,
  PayoutStatus,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

type CreatePayoutParams = {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
};

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPayout(params: CreatePayoutParams): Promise<Payout> {
    const {
      accountId,
      amount,
      destinationAddress,
      idempotencyKey,
    } = params;

    // First try to find existing payout for idempotency
    const existing = await this.prisma.payout.findUnique({
      where: { idempotency_key: idempotencyKey },
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Conditional reserve: only succeed if sufficient available funds
        const reserveResult = await tx.$executeRaw<
          Prisma.Sql
        >`UPDATE accounts
           SET reserved_balance = reserved_balance + ${amount}
           WHERE id = ${accountId}
           AND (settled_balance - reserved_balance) >= ${amount}`;

        // $executeRaw returns number of rows affected
        if (reserveResult === 0) {
          throw new HttpException(
            {
              error: {
                code: 'insufficient_funds',
                message: 'Not enough available balance',
                details: {},
              },
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // Create payout row
        const payout = await tx.payout.create({
          data: {
            accountId,
            amount,
            destination_address: destinationAddress,
            idempotency_key: idempotencyKey,
            status: 'CREATED',
          },
        });

        // Insert outbox message within same transaction
        await tx.outboxMessage.create({
          data: {
            payoutId: payout.id,
            attempts: 0,
            max_attempts: 3,
            next_attempt_at: new Date(),
            status: 'PENDING',
          },
        });

        return payout;
      });
    } catch (err: any) {
      // Handle race condition on idempotency unique constraint
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002' // Unique constraint failed
      ) {
        const dup = await this.prisma.payout.findUnique({
          where: { idempotency_key: idempotencyKey },
        });
        if (dup) return dup;
      }
      throw err;
    }
  }

  async findPayoutById(id: string) {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  async updatePayoutStatus(
    payoutId: string,
    from: PayoutStatus,
    to: PayoutStatus,
  ): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: from },
      data: { status: to },
    });
    return result.count > 0;
  }

  async setPayoutTxHash(payoutId: string, txHash: string) {
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: { tx_hash: txHash, status: 'SENT' },
    });
  }

  async finalizeSettlement(payoutId: string, amount: bigint) {
    await this.prisma.$transaction(async (tx) => {
      // Debit settled balance and release reservation
      await tx.account.updateMany({
        where: { id: (await tx.payout.findUnique({ where: { id: payoutId } }))!.accountId },
        data: {
          settled_balance: {
            decrement: amount,
          },
          reserved_balance: {
            decrement: amount,
          },
        },
      });

      // Create ledger entry (debit)
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      await tx.ledgerEntry.create({
        data: {
          accountId: payout!.accountId,
          amount: -amount,
          description: `Payout ${payoutId} settled`,
        },
      });
    });
  }

  async findPendingMessages(limit: number): Promise<OutboxMessage[]> {
    return this.prisma.outboxMessage.findMany({
      where: {
        status: 'PENDING',
        next_attempt_at: { lte: new Date() },
      },
      orderBy: { next_attempt_at: 'asc' },
      take: limit,
    });
  }

  async markMessageDone(messageId: string) {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'DONE' },
    });
  }

  async incrementMessageAttempts(message: OutboxMessage) {
    await this.prisma.outboxMessage.update({
      where: { id: message.id },
      data: {
        attempts: { increment: 1 },
        next_attempt_at: new Date(Date.now() + 5_000), // 5 seconds back‑off
      },
    });
  }

  async failMessage(messageId: string) {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'FAILED' },
    });
  }

  async setPayoutNeedsReview(payoutId: string) {
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: { status: 'NEEDS_REVIEW' },
    });
  }
}
