import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  Payout,
  Message,
  Account,
  LedgerEntry,
  Prisma,
} from '@prisma/client';
import { InsufficientFundsError } from './payout.service.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

class ReservationConflictError extends Error {
  constructor() {
    super('Reservation conflict');
    this.name = 'ReservationConflictError';
  }
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdempotencyKey(idempotencyKey: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { idempotency_key: idempotencyKey },
    });
  }

  async findPayoutById(payoutId: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { id: payoutId },
    });
  }

  async createPayoutWithReservation(
    accountId: string,
    amount: bigint,
    destinationAddress: string,
    idempotencyKey: string,
  ): Promise<Payout> {
    const maxAttempts = 5;
    let attempt = 0;

    while (attempt < maxAttempts) {
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
        select: {
          id: true,
          settled_balance: true,
          reserved_balance: true,
          version: true,
        },
      });

      if (!account) {
        throw new Error(`Account ${accountId} not found`);
      }

      const available = account.settled_balance - account.reserved_balance;
      if (available < amount) {
        throw new InsufficientFundsError('Insufficient available funds');
      }

      try {
        const payout = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const reservationResult = await tx.$executeRaw<
            Prisma.Sql
          >`UPDATE "account"
            SET reserved_balance = reserved_balance + ${amount},
                version = version + 1
            WHERE id = ${accountId}
              AND version = ${account.version}
              AND (settled_balance - reserved_balance) >= ${amount}`;

          if (Number(reservationResult) === 0) {
            throw new ReservationConflictError();
          }

          const newPayout = await tx.payout.create({
            data: {
              account_id: accountId,
              amount: amount,
              destination_address: destinationAddress,
              status: 'QUEUED',
              idempotency_key: idempotencyKey,
            },
          });

          await tx.message.create({
            data: {
              payout_id: newPayout.id,
              status: 'PENDING',
              attempts: 0,
              max_attempts: 3,
            },
          });

          return newPayout;
        });

        return payout;
      } catch (e: any) {
        if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
          const existing = await this.findByIdempotencyKey(idempotencyKey);
          if (existing) {
            return existing;
          }
          throw e;
        }
        if (e instanceof ReservationConflictError) {
          attempt++;
          continue;
        }
        throw e;
      }
    }

    throw new Error('Failed to reserve funds after multiple attempts');
  }

  async fetchNextPendingMessage(): Promise<Message | null> {
    return this.prisma.message.findFirst({
      where: { status: 'PENDING' },
      orderBy: { created_at: 'asc' },
    });
  }

  async lockMessage(messageId: string): Promise<boolean> {
    const result = await this.prisma.message.updateMany({
      where: { id: messageId, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    return result.count > 0;
  }

  async incrementMessageAttempts(messageId: string, error: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        attempts: { increment: 1 },
        last_error: error,
      },
    });
  }

  async resetMessageToPending(messageId: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: 'PENDING' },
    });
  }

  async markMessageDone(messageId: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: 'DONE' },
    });
  }

  async markMessageFailed(messageId: string, error: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: 'FAILED', last_error: error },
    });
  }

  async getMessageAttempts(messageId: string): Promise<number> {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { attempts: true },
    });
    return msg?.attempts ?? 0;
  }

  async settlePayout(payoutId: string, txHash: string): Promise<void> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { account: true },
    });
    if (!payout) {
      throw new Error(`Payout ${payoutId} not found`);
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.account.update({
        where: { id: payout.account_id },
        data: {
          settled_balance: { decrement: payout.amount },
          reserved_balance: { decrement: payout.amount },
          version: { increment: 1 },
        },
      });

      await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: 'COMPLETED',
          tx_hash: txHash,
          updated_at: new Date(),
        },
      });

      await tx.ledgerEntry.create({
        data: {
          account_id: payout.account_id,
          amount: -payout.amount,
          description: `Payout ${payout.id}`,
        },
      });
    });
  }

  async markPayoutNeedsReview(payoutId: string, _error: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: { status: 'NEEDS_REVIEW' },
    });
  }

  async getMessageByPayoutId(payoutId: string): Promise<Message | null> {
    return this.prisma.message.findUnique({
      where: { payout_id: payoutId },
    });
  }
}
