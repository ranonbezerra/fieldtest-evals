import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  Payout,
  OutboxMessage,
  Account,
  LedgerEntry,
  Prisma,
} from '@prisma/client';

// Parameters needed to create a payout with reservation
export interface CreatePayoutParams {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Creates a payout while atomically reserving funds and inserting an outbox message.
  // Idempotent via the unique (accountId, idempotencyKey) constraint.
  async createPayout(params: CreatePayoutParams): Promise<Payout> {
    const { accountId, amount, destinationAddress, idempotencyKey } = params;

    // Fast path: return existing payout if the idempotency key was already used.
    const existing = await this.prisma.payout.findFirst({
      where: { accountId, idempotencyKey },
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Reserve funds atomically; fails if insufficient available balance.
        const updatedRows = await tx.$executeRaw`
          UPDATE "Account"
          SET "reserved_balance" = "reserved_balance" + ${amount}
          WHERE "id" = ${accountId}
            AND ("settled_balance" - "reserved_balance") >= ${amount}
        `;

        if (updatedRows === 0) {
          throw new BadRequestException('Insufficient funds');
        }

        // Create the payout record (status PENDING).
        const payout = await tx.payout.create({
          data: {
            accountId,
            amount,
            destinationAddress,
            idempotencyKey,
            status: 'PENDING',
          },
        });

        // Insert the outbox message that will trigger asynchronous processing.
        await tx.outboxMessage.create({
          data: {
            payoutId: payout.id,
          },
        });

        return payout;
      });
    } catch (error) {
      // If the transaction failed due to the unique constraint, fetch the existing payout.
      const existingAfter = await this.prisma.payout.findFirst({
        where: { accountId, idempotencyKey },
      });
      if (existingAfter) {
        return existingAfter;
      }
      throw error;
    }
  }

  // Retrieve a batch of pending outbox messages (at‑least‑once delivery).
  async findPendingMessages(limit: number): Promise<OutboxMessage[]> {
    return this.prisma.outboxMessage.findMany({
      where: { processed: false },
      take: limit,
    });
  }

  async markMessageProcessed(id: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: { processed: true },
    });
  }

  async setMessageAttempts(id: string, attempts: number): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: { attempts },
    });
  }

  async getPayoutById(payoutId: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id: payoutId } });
  }

  async updatePayoutStatus(payoutId: string, status: string, txHash?: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status,
        ...(txHash ? { txHash } : {}),
      },
    });
  }

  // Settlement: debit settled balance, release the reservation, and write a ledger entry.
  async settlePayout(payout: Payout): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          settledBalance: { decrement: payout.amount },
          reservedBalance: { decrement: payout.amount },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          accountId: payout.accountId,
          payoutId: payout.id,
          type: 'SETTLEMENT',
          amount: payout.amount * -1n,
        },
      });
    });
  }
}
