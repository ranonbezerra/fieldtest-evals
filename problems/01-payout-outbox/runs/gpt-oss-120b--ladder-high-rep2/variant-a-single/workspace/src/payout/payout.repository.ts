import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Payout, Prisma } from '@prisma/client';

/**
 * Error indicating insufficient funds for reservation.
 */
export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient funds');
    this.name = 'InsufficientFundsError';
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

  /**
   * Atomically reserves funds, creates the payout row, and enqueues an outbox message.
   * Throws InsufficientFundsError if the account lacks sufficient available balance.
   */
  async reserveAndCreatePayout(
    accountId: string,
    amount: bigint,
    destinationAddress: string,
    idempotencyKey: string,
  ): Promise<Payout> {
    return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Reserve funds in a single conditional UPDATE
      const reservationResult = await tx.$executeRaw`
        UPDATE "account"
        SET reserved_balance = reserved_balance + ${amount}
        WHERE id = ${accountId}
          AND (settled_balance - reserved_balance) >= ${amount}
      `;

      const rowsAffected = Number(reservationResult);
      if (rowsAffected !== 1) {
        throw new InsufficientFundsError();
      }

      // Create the payout record (status defaults to PENDING)
      const payout = await tx.payout.create({
        data: {
          account_id: accountId,
          amount,
          destination_address: destinationAddress,
          idempotency_key: idempotencyKey,
        },
      });

      // Insert the outbox message within the same transaction
      await tx.message.create({
        data: {
          payout_id: payout.id,
        },
      });

      return payout;
    });
  }
}
