import { Injectable } from '@nestjs/common';
import {
  LedgerBucket,
  LedgerSide,
  MessageStatus,
  Payout,
  PayoutStatus,
  Prisma,
} from '@prisma/client';
import type { OutboxMessage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AccountNotFoundError,
  DuplicateIdempotencyKeyError,
  InsufficientFundsError,
} from './payout-errors.js';

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a payout, reserve the funds, write the balanced ledger pair, and
   * queue the transfer — all in one transaction. The payout row is inserted
   * first so an idempotency-key collision is detected before any funds move.
   */
  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.account.findUnique({ where: { id: input.accountId } });
        if (!account) {
          throw new AccountNotFoundError(input.accountId);
        }

        const payout = await tx.payout.create({
          data: {
            accountId: input.accountId,
            amount: input.amount,
            destinationAddress: input.destinationAddress,
            idempotencyKey: input.idempotencyKey,
            status: PayoutStatus.CREATED,
          },
        });

        // The check and the reservation are one atomic statement. Postgres
        // serializes concurrent updates on the account row and re-evaluates
        // the predicate against the committed state, so at most one of two
        // racing callers can win; the loser gets zero rows.
        const reserved = await tx.$executeRaw`
          UPDATE "accounts"
          SET "reserved" = "reserved" + ${input.amount.toString()}::bigint
          WHERE "id" = ${input.accountId}
            AND "settled" - "reserved" >= ${input.amount.toString()}::bigint
        `;
        if (reserved === 0) {
          throw new InsufficientFundsError(input.accountId);
        }

        // Double-entry reservation: the hold grows (DEBIT HELD) and the
        // available portion shrinks (CREDIT AVAILABLE). The settled balance
        // is not touched here.
        await tx.ledgerEntry.createMany({
          data: [
            { payoutId: payout.id, bucket: LedgerBucket.HELD, side: LedgerSide.DEBIT, amount: input.amount },
            { payoutId: payout.id, bucket: LedgerBucket.AVAILABLE, side: LedgerSide.CREDIT, amount: input.amount },
          ],
        });

        // The queue row is written inside the same transaction as the
        // reservation: a crash can never leave funds held with nothing
        // queued, or a queued transfer with nothing reserved.
        await tx.outboxMessage.create({
          data: { payoutId: payout.id, status: MessageStatus.PENDING },
        });

        return payout;
      });
    } catch (error) {
      if (error instanceof AccountNotFoundError || error instanceof InsufficientFundsError) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // The (accountId, idempotencyKey) unique constraint: a retried key.
        throw new DuplicateIdempotencyKeyError(input.accountId, input.idempotencyKey);
      }
      throw error;
    }
  }

  findPayoutById(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  findPayoutByKey(accountId: string, idempotencyKey: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { accountId_idempotencyKey: { accountId, idempotencyKey } },
    });
  }

  findDueMessages(now: Date, leaseCutoff: Date, take: number): Promise<OutboxMessage[]> {
    return this.prisma.outboxMessage.findMany({
      where: {
        OR: [
          { status: MessageStatus.PENDING, nextAttemptAt: { lte: now } },
          { status: MessageStatus.IN_FLIGHT, claimedAt: { lt: leaseCutoff } },
        ],
      },
      orderBy: { nextAttemptAt: 'asc' },
      take,
    });
  }

  /**
   * Claim a message with a conditional update. Returns the claimed message,
   * or null if another worker owns it or it is already processed. Expired
   * IN_FLIGHT claims (a crashed worker) can be taken over.
   */
  async claimMessage(id: string, leaseCutoff: Date): Promise<OutboxMessage | null> {
    const claimed = await this.prisma.$executeRaw`
      UPDATE "outbox_messages"
      SET "status" = 'IN_FLIGHT'::"MessageStatus",
          "claimed_at" = now()
      WHERE "id" = ${id}
        AND (
              "status" = 'PENDING'::"MessageStatus" AND "next_attempt_at" <= now()
           OR "status" = 'IN_FLIGHT'::"MessageStatus" AND "claimed_at" < ${leaseCutoff.toISOString()}::timestamptz
        )
    `;
    if (claimed === 0) {
      return null;
    }
    return this.prisma.outboxMessage.findUnique({ where: { id } });
  }

  markProcessing(payoutId: string): Promise<{ count: number }> {
    return this.prisma.payout.updateMany({
      where: { id: payoutId, status: PayoutStatus.CREATED },
      data: { status: PayoutStatus.PROCESSING },
    });
  }

  /**
   * Record the txHash. Guarded so a payout that already has a hash can never
   * record a second one; returns the authoritative (status, txHash).
   */
  async recordTxHash(payoutId: string, txHash: string): Promise<{ status: PayoutStatus; txHash: string }> {
    const recorded = await this.prisma.payout.updateMany({
      where: {
        id: payoutId,
        status: { in: [PayoutStatus.CREATED, PayoutStatus.PROCESSING] },
        txHash: null,
      },
      data: { status: PayoutStatus.SENT, txHash },
    });
    if (recorded.count > 0) {
      return { status: PayoutStatus.SENT, txHash };
    }
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout || payout.txHash === null) {
      throw new Error(`cannot record txHash: payout ${payoutId} is not in a recordable state`);
    }
    return { status: payout.status, txHash: payout.txHash };
  }

  /**
   * Settle the payout: the only place where the account's settled balance
   * moves. Guarded SENT -> COMPLETED; the reservation is released and the
   * ledger pair is written in the same transaction.
   */
  async settlePayout(payoutId: string, accountId: string, amount: bigint): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.payout.updateMany({
        where: { id: payoutId, status: PayoutStatus.SENT, txHash: { not: null } },
        data: { status: PayoutStatus.COMPLETED },
      });
      if (transitioned.count === 0) {
        return false; // already settled (or not sent yet): no-op
      }

      const debited = await tx.$executeRaw`
        UPDATE "accounts"
        SET "settled" = "settled" - ${amount.toString()}::bigint,
            "reserved" = "reserved" - ${amount.toString()}::bigint
        WHERE "id" = ${accountId}
          AND "reserved" >= ${amount.toString()}::bigint
      `;
      if (debited === 0) {
        // The reservation must exist: it was written atomically with the payout.
        throw new Error(`settlement aborted: account ${accountId} is missing its reservation`);
      }

      // Double-entry settlement: funds leave the platform (DEBIT PAID_OUT)
      // and the hold is released (CREDIT HELD).
      await tx.ledgerEntry.createMany({
        data: [
          { payoutId, bucket: LedgerBucket.PAID_OUT, side: LedgerSide.DEBIT, amount },
          { payoutId, bucket: LedgerBucket.HELD, side: LedgerSide.CREDIT, amount },
        ],
      });
      return true;
    });
  }

  recordAttempt(payoutId: string, attempts: number, reason: string): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: { attempts, lastError: reason },
    });
  }

  markNeedsReview(payoutId: string, attempts: number, reason: string): Promise<{ count: number }> {
    return this.prisma.payout.updateMany({
      where: {
        id: payoutId,
        status: { in: [PayoutStatus.CREATED, PayoutStatus.PROCESSING, PayoutStatus.SENT] },
      },
      data: { status: PayoutStatus.NEEDS_REVIEW, attempts, lastError: reason },
    });
  }

  completeMessage(id: string, attempts: number): Promise<OutboxMessage> {
    return this.prisma.outboxMessage.update({
      where: { id },
      data: { status: MessageStatus.PROCESSED, attempts, processedAt: new Date() },
    });
  }

  rescheduleMessage(id: string, attempts: number, nextAttemptAt: Date): Promise<OutboxMessage> {
    return this.prisma.outboxMessage.update({
      where: { id },
      data: { status: MessageStatus.PENDING, attempts, nextAttemptAt },
    });
  }
}
