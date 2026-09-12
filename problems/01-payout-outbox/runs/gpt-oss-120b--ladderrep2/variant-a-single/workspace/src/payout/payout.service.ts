import { Injectable } from '@nestjs/common';
import { PrismaClient, Payout, PayoutStatus } from '@prisma/client';
import { PayoutRepository } from './payout.repository.js';

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

@Injectable()
export class PayoutService {
  private readonly MAX_RESERVATION_RETRIES = 5;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: PayoutRepository,
  ) {}

  /**
   * Creates a payout atomically:
   * - Idempotent by (accountId, idempotencyKey)
   * - Reserves funds in the same transaction that creates the message row
   */
  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    const { accountId, amount, destinationAddress, idempotencyKey } = input;

    return await this.prisma.$transaction(async (tx) => {
      // Idempotency check – if a payout with the same key exists, return it
      const existing = await tx.payout.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId,
            idempotencyKey,
          },
        },
      });
      if (existing) {
        return existing;
      }

      // Reserve funds atomically using a conditional UPDATE
      const reserveResult = await tx.$executeRaw<
        // Prisma returns number of rows affected for UPDATE
        number
      >`UPDATE "Account"
          SET "reserved_balance" = "reserved_balance" + ${amount}
          WHERE "id" = ${accountId}
            AND ("settled_balance" - "reserved_balance") >= ${amount}`;

      if (reserveResult === 0) {
        const err: any = new Error('Insufficient available balance');
        err.code = 'INSUFFICIENT_FUNDS';
        throw err;
      }

      // Create payout row (status = CREATED)
      const payout = await tx.payout.create({
        data: {
          accountId,
          amount,
          destinationAddress,
          idempotencyKey,
          status: PayoutStatus.CREATED,
        },
      });

      // Insert message row inside the same transaction
      await tx.message.create({
        data: {
          payoutId: payout.id,
        },
      });

      return payout;
    });
  }

  /** Used by the worker to transition payout status safely */
  async markProcessing(payoutId: string): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: {
        id: payoutId,
        status: PayoutStatus.CREATED,
      },
      data: {
        status: PayoutStatus.PROCESSING,
      },
    });
    return result.count === 1;
  }

  async settlePayout(params: {
    payoutId: string;
    txHash: string;
  }): Promise<void> {
    const { payoutId, txHash } = params;
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
      });

      // Debit settled balance and release reservation
      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          settledBalance: {
            decrement: payout.amount,
          },
          reservedBalance: {
            decrement: payout.amount,
          },
        },
      });

      // Record ledger entry (debit)
      await tx.ledgerEntry.create({
        data: {
          accountId: payout.accountId,
          amount: -payout.amount,
          description: `Payout ${payout.id} settled`,
          payoutId: payout.id,
        },
      });

      // Update payout status
      await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.COMPLETED,
          txHash,
        },
      });
    });
  }

  async failPayout(payoutId: string, reason: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.NEEDS_REVIEW,
        // In a real system we could store the reason in a json column
      },
    });
  }
}
