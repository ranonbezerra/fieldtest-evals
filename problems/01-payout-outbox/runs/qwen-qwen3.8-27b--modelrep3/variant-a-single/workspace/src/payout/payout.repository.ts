import { Injectable } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import type { Account, Payout } from '@prisma/client';
import { InsufficientFundsError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreatePayoutInput {
  accountId: string;
  amountMinor: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface DueMessage {
  id: string;
  payoutId: string;
  attempts: number;
}

/**
 * The only layer that touches the database. Every payout state change is a
 * guarded UPDATE (WHERE status = expected) so that at-least-once message
 * delivery can never apply a transition twice.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccount(id: string): Promise<Account | null> {
    return this.prisma.account.findUnique({ where: { id } });
  }

  findPayoutByIdempotencyKey(idempotencyKey: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { idempotencyKey } });
  }

  async findPayoutForMessage(messageId: string): Promise<Payout | null> {
    const message = await this.prisma.payoutMessage.findUnique({
      where: { id: messageId },
      include: { payout: true },
    });
    return message ? message.payout : null;
  }

  /**
   * Creates the payout, atomically reserves its amount, posts the balanced
   * reserve entries and enqueues the outbox message — all or nothing.
   *
   * The payout row is inserted first, so a duplicate idempotency key aborts
   * the transaction (unique constraint) before any funds are touched.
   * The reserve is a single conditional UPDATE: concurrent requests are
   * serialized on the account row and the WHERE clause is re-evaluated
   * against the latest committed value, so the account cannot be overdrawn.
   */
  async createPayoutWithReserve(input: CreatePayoutInput): Promise<Payout> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amountMinor: input.amountMinor,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: PayoutStatus.CREATED,
        },
      });

      const reserved = await tx.$queryRaw<Array<{ settled_minor: bigint; held_minor: bigint }>>`
        UPDATE "accounts"
        SET "held_minor" = "held_minor" + ${input.amountMinor},
            "updated_at" = now()
        WHERE "id" = ${input.accountId}
          AND "settled_minor" - "held_minor" >= ${input.amountMinor}
        RETURNING "settled_minor", "held_minor"
      `;

      if (reserved.length === 0) {
        const account = await tx.account.findUnique({ where: { id: input.accountId } });
        const availableMinor = account ? account.settledMinor - account.heldMinor : 0n;
        throw new InsufficientFundsError(input.accountId, input.amountMinor, availableMinor);
      }

      await tx.ledgerEntry.createMany({
        data: [
          {
            payoutId: payout.id,
            action: 'RESERVE',
            account: `settled:${input.accountId}`,
            debitMinor: input.amountMinor,
            creditMinor: 0n,
            memo: 'funds reserved for payout',
          },
          {
            payoutId: payout.id,
            action: 'RESERVE',
            account: `held:${input.accountId}`,
            debitMinor: 0n,
            creditMinor: input.amountMinor,
            memo: 'funds on hold for payout',
          },
        ],
      });

      await tx.payoutMessage.create({
        data: {
          payoutId: payout.id,
          payload: { payoutId: payout.id },
          nextAttemptAt: new Date(),
        },
      });

      return payout;
    });
  }

  // ---- payout transitions (guarded => idempotent under redelivery) ----

  async startPayoutProcessing(payoutId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "payouts"
      SET "status" = 'PROCESSING', "updated_at" = now()
      WHERE "id" = ${payoutId} AND "status" = 'CREATED'
      RETURNING "id"
    `;
    return rows.length > 0;
  }

  async markPayoutSent(payoutId: string, txHash: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "payouts"
      SET "status" = 'SENT', "tx_hash" = ${txHash}, "sent_at" = now(), "updated_at" = now()
      WHERE "id" = ${payoutId} AND "status" = 'PROCESSING'
      RETURNING "id"
    `;
    return rows.length > 0;
  }

  /**
   * SENT -> COMPLETED. Settles the account (settled and held both decrease by
   * the amount) and posts the balanced complete entries in one transaction.
   * Returns false when the payout is not in SENT, so duplicate delivery
   * cannot settle twice.
   */
  async finalizePayout(payoutId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!payout || payout.status !== 'SENT') return false;

      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "payouts"
        SET "status" = 'COMPLETED', "completed_at" = now(), "updated_at" = now()
        WHERE "id" = ${payoutId} AND "status" = 'SENT'
        RETURNING "id"
      `;
      if (rows.length === 0) return false;

      const settled = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "accounts"
        SET "settled_minor" = "settled_minor" - ${payout.amountMinor},
            "held_minor" = "held_minor" - ${payout.amountMinor},
            "updated_at" = now()
        WHERE "id" = ${payout.accountId} AND "held_minor" >= ${payout.amountMinor}
        RETURNING "id"
      `;
      if (settled.length === 0) {
        throw new Error(`cannot settle payout ${payoutId}: expected hold is missing on the account`);
      }

      await tx.ledgerEntry.createMany({
        data: [
          {
            payoutId,
            action: 'COMPLETE',
            account: `held:${payout.accountId}`,
            debitMinor: payout.amountMinor,
            creditMinor: 0n,
            memo: 'provider confirmed the transfer; hold settled',
          },
          {
            payoutId,
            action: 'COMPLETE',
            account: 'transfers_out',
            debitMinor: 0n,
            creditMinor: payout.amountMinor,
            memo: 'funds left the platform via the provider',
          },
        ],
      });

      return true;
    });
  }

  /**
   * CREATED/PROCESSING -> FAILED. Releases the hold back to the available
   * balance and posts the balanced release entries (definitive provider
   * rejection: the transfer did not happen).
   */
  async failPayout(payoutId: string, reason: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!payout || (payout.status !== 'CREATED' && payout.status !== 'PROCESSING')) return false;

      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "payouts"
        SET "status" = 'FAILED', "error" = ${reason}, "updated_at" = now()
        WHERE "id" = ${payoutId} AND "status" IN ('CREATED', 'PROCESSING')
        RETURNING "id"
      `;
      if (rows.length === 0) return false;

      const released = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "accounts"
        SET "held_minor" = "held_minor" - ${payout.amountMinor}, "updated_at" = now()
        WHERE "id" = ${payout.accountId} AND "held_minor" >= ${payout.amountMinor}
        RETURNING "id"
      `;
      if (released.length === 0) {
        throw new Error(`cannot fail payout ${payoutId}: expected hold is missing on the account`);
      }

      await tx.ledgerEntry.createMany({
        data: [
          {
            payoutId,
            action: 'RELEASE',
            account: `held:${payout.accountId}`,
            debitMinor: payout.amountMinor,
            creditMinor: 0n,
            memo: 'definitive provider rejection; hold released',
          },
          {
            payoutId,
            action: 'RELEASE',
            account: `settled:${payout.accountId}`,
            debitMinor: 0n,
            creditMinor: payout.amountMinor,
            memo: 'funds returned to the available balance',
          },
        ],
      });

      return true;
    });
  }

  /**
   * CREATED/PROCESSING -> NEEDS_REVIEW. Retries were exhausted without a
   * definitive outcome. The hold is deliberately kept: the transfer may have
   * happened (a timeout is not a failure), and only manual on-chain
   * reconciliation may settle or release it.
   */
  async escalatePayout(payoutId: string, reason: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "payouts"
      SET "status" = 'NEEDS_REVIEW', "error" = ${reason}, "updated_at" = now()
      WHERE "id" = ${payoutId} AND "status" IN ('CREATED', 'PROCESSING')
      RETURNING "id"
    `;
    return rows.length > 0;
  }

  // ---- outbox (message) operations ----

  takeDueMessages(limit: number): Promise<DueMessage[]> {
    return this.prisma.payoutMessage.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, payoutId: true, attempts: true },
    });
  }

  async claimMessage(messageId: string): Promise<boolean> {
    const result = await this.prisma.payoutMessage.updateMany({
      where: { id: messageId, status: 'PENDING' },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, claimedAt: new Date() },
    });
    return result.count > 0;
  }

  markMessageProcessed(messageId: string): Promise<void> {
    return this.prisma.payoutMessage
      .updateMany({
        where: { id: messageId, status: 'PROCESSING' },
        data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
      })
      .then(() => undefined);
  }

  scheduleMessageRetry(messageId: string, nextAttemptAt: Date, lastError: string): Promise<void> {
    return this.prisma.payoutMessage
      .updateMany({
        where: { id: messageId, status: 'PROCESSING' },
        data: { status: 'PENDING', nextAttemptAt, lastError },
      })
      .then(() => undefined);
  }

  markMessageDead(messageId: string, lastError: string): Promise<void> {
    return this.prisma.payoutMessage
      .updateMany({
        where: { id: messageId, status: 'PROCESSING' },
        data: { status: 'DEAD', processedAt: new Date(), lastError },
      })
      .then(() => undefined);
  }

  /**
   * Re-queues messages stuck in PROCESSING (for example after a worker
   * crash). This is what makes delivery at-least-once; consumers must
   * therefore be idempotent (they are, via the guarded transitions).
   */
  recoverStaleMessages(cutoff: Date): Promise<number> {
    return this.prisma.payoutMessage
      .updateMany({
        where: { status: 'PROCESSING', claimedAt: { lt: cutoff } },
        data: { status: 'PENDING', claimedAt: null },
      })
      .then((r) => r.count);
  }
}
