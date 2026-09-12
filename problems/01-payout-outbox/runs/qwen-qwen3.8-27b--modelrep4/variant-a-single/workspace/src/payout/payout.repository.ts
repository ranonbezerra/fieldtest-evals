import { Inject, Injectable } from '@nestjs/common';
import { LedgerDirection, Prisma, PrismaClient, type Payout, type PayoutMessage } from '@prisma/client';

/** Injection token for the shared PrismaClient (created in payout.module.ts). */
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');

export interface CreatePayoutInput {
  accountId: string;
  amountMinor: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export type CreatePayoutOutcome =
  | { outcome: 'created'; payout: Payout }
  | { outcome: 'duplicate'; payout: Payout }
  | { outcome: 'account_not_found' }
  | { outcome: 'insufficient_funds'; availableMinor: bigint };

const MAX_ERROR_LENGTH = 500;

function truncate(value: string): string {
  return value.length > MAX_ERROR_LENGTH ? value.slice(0, MAX_ERROR_LENGTH) : value;
}

function isIdempotencyKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = (error.meta?.target ?? []) as string | string[] | undefined;
  const fields = Array.isArray(target) ? target : target ? [target] : [];
  return fields.includes('idempotency_key');
}

@Injectable()
export class PayoutRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  findPayoutById(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  findPayoutByIdempotencyKey(idempotencyKey: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { idempotencyKey } });
  }

  /**
   * Atomically: reserve the funds (guarded debit), create the payout, post the
   * balanced `reserved` ledger pair, and enqueue the outbox message. The
   * guarded debit is the concurrency guard that makes overdrawing impossible;
   * the unique idempotency_key makes a concurrent duplicate fail cleanly.
   */
  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutOutcome> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const debited = await tx.account.updateMany({
          where: { id: input.accountId, availableMinor: { gte: input.amountMinor } },
          data: { availableMinor: { decrement: input.amountMinor } },
        });
        if (debited.count === 0) {
          const account = await tx.account.findUnique({ where: { id: input.accountId } });
          if (!account) {
            return { outcome: 'account_not_found' as const };
          }
          return { outcome: 'insufficient_funds' as const, availableMinor: account.availableMinor };
        }

        const payout = await tx.payout.create({
          data: {
            accountId: input.accountId,
            amountMinor: input.amountMinor,
            destinationAddress: input.destinationAddress,
            idempotencyKey: input.idempotencyKey,
          },
        });

        await tx.ledgerEntry.create({
          data: [
            {
              payoutId: payout.id,
              event: 'reserved',
              accountCode: `payable:${input.accountId}:available`,
              direction: LedgerDirection.debit,
              amountMinor: input.amountMinor,
            },
            {
              payoutId: payout.id,
              event: 'reserved',
              accountCode: `payable:${input.accountId}:pending`,
              direction: LedgerDirection.credit,
              amountMinor: input.amountMinor,
            },
          ] satisfies Prisma.LedgerEntryUncheckedCreateInput[],
        });

        await tx.payoutMessage.create({ data: { payoutId: payout.id } });

        return { outcome: 'created' as const, payout };
      });
    } catch (error) {
      if (isIdempotencyKeyConflict(error)) {
        // A concurrent call with the same key won the race; our transaction
        // rolled back, so nothing was double-reserved.
        const existing = await this.findPayoutByIdempotencyKey(input.idempotencyKey);
        if (existing) {
          return { outcome: 'duplicate', payout: existing };
        }
      }
      throw error;
    }
  }

  /**
   * Claim up to `limit` due messages (pending and due, or processing and
   * stale). The claim is a guarded UPDATE re-checked against the same
   * claimability conditions, so concurrent pollers never claim the same
   * message twice.
   */
  async claimMessages(limit: number, claimToken: string, staleAfterMs: number): Promise<PayoutMessage[]> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleAfterMs);
    const claimable: Prisma.PayoutMessageWhereInput = {
      OR: [
        { status: 'pending', nextAttemptAt: { lte: now } },
        { status: 'processing', lockedAt: { lte: staleBefore } },
      ],
    };
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.payoutMessage.findMany({
        where: claimable,
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      const ids = candidates.map((message) => message.id);
      if (ids.length === 0) {
        return [];
      }
      await tx.payoutMessage.updateMany({
        where: { id: { in: ids }, ...claimable },
        data: { status: 'processing', claimToken, lockedAt: now },
      });
      return tx.payoutMessage.findMany({
        where: { id: { in: ids }, claimToken },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  /** created -> processing. Returns rows flipped (0 means a concurrent worker owns it). */
  async transitionToProcessing(payoutId: string): Promise<number> {
    const result = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'created' },
      data: { status: 'processing' },
    });
    return result.count;
  }

  /**
   * Provider confirmed the transfer. Atomically: processing -> sent (txHash),
   * debit the reservation to the platform cash, post the balanced `settled`
   * pair, sent -> completed, and finish the message. Every step is guarded,
   * so a duplicate delivery cannot post the ledger twice.
   */
  async applySent(payoutId: string, messageId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.payout.updateMany({
        where: { id: payoutId, status: 'processing' },
        data: { status: 'sent', txHash },
      });
      if (flipped.count === 0) {
        await this.settleDuplicateDelivery(tx, payoutId, messageId);
        return;
      }
      const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      const debited = await tx.account.updateMany({
        where: { id: payout.accountId, pendingMinor: { gte: payout.amountMinor } },
        data: { pendingMinor: { decrement: payout.amountMinor } },
      });
      if (debited.count !== 1) {
        throw new Error(`ledger invariant violated: payout ${payoutId} has no matching reservation`);
      }
      await tx.ledgerEntry.create({
        data: [
          {
            payoutId,
            event: 'settled',
            accountCode: `payable:${payout.accountId}:pending`,
            direction: LedgerDirection.debit,
            amountMinor: payout.amountMinor,
          },
          {
            payoutId,
            event: 'settled',
            accountCode: 'cash:stablecoin',
            direction: LedgerDirection.credit,
            amountMinor: payout.amountMinor,
          },
        ] satisfies Prisma.LedgerEntryUncheckedCreateInput[],
      });
      await tx.payout.updateMany({
        where: { id: payoutId, status: 'sent' },
        data: { status: 'completed' },
      });
      await this.markMessageDone(tx, messageId);
    });
  }

  /**
   * The provider rejected definitively: the transfer is known not to have
   * happened. Atomically: processing -> failed, release the reservation
   * (balanced `released` reversal), and finish the message.
   */
  async applyFailed(payoutId: string, messageId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.payout.updateMany({
        where: { id: payoutId, status: 'processing' },
        data: { status: 'failed', failureReason: truncate(reason) },
      });
      if (flipped.count === 0) {
        await this.settleDuplicateDelivery(tx, payoutId, messageId);
        return;
      }
      const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      const released = await tx.account.updateMany({
        where: { id: payout.accountId, pendingMinor: { gte: payout.amountMinor } },
        data: {
          availableMinor: { increment: payout.amountMinor },
          pendingMinor: { decrement: payout.amountMinor },
        },
      });
      if (released.count !== 1) {
        throw new Error(`ledger invariant violated: payout ${payoutId} has no matching reservation`);
      }
      await tx.ledgerEntry.create({
        data: [
          {
            payoutId,
            event: 'released',
            accountCode: `payable:${payout.accountId}:pending`,
            direction: LedgerDirection.debit,
            amountMinor: payout.amountMinor,
          },
          {
            payoutId,
            event: 'released',
            accountCode: `payable:${payout.accountId}:available`,
            direction: LedgerDirection.credit,
            amountMinor: payout.amountMinor,
          },
        ] satisfies Prisma.LedgerEntryUncheckedCreateInput[],
      });
      await this.markMessageDone(tx, messageId);
    });
  }

  /**
   * Retries exhausted without a definitive outcome. The payout is parked in
   * needs_review and the message stops being delivered. Deliberately NO ledger
   * movement: the outcome is unknown, so the reservation stays (DESIGN.md).
   */
  async applyExhausted(payoutId: string, messageId: string, attempts: number, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.payout.updateMany({
        where: { id: payoutId, status: 'processing' },
        data: { status: 'needs_review', failureReason: truncate(reason) },
      });
      if (flipped.count === 0) {
        await this.settleDuplicateDelivery(tx, payoutId, messageId);
        return;
      }
      await tx.payoutMessage.update({
        where: { id: messageId },
        data: { status: 'dead', attempts, lastError: truncate(reason), claimToken: null, lockedAt: null },
      });
    });
  }

  /** Bump the attempt count and schedule the next try. */
  async applyRetry(messageId: string, attempts: number, nextAttemptAt: Date, reason: string): Promise<void> {
    await this.prisma.payoutMessage.update({
      where: { id: messageId },
      data: {
        status: 'pending',
        attempts,
        nextAttemptAt,
        lastError: truncate(reason),
        claimToken: null,
        lockedAt: null,
      },
    });
  }

  /** Terminate a claimed message (idempotent: only flips messages in 'processing'). */
  async finishMessage(messageId: string, status: 'done' | 'dead'): Promise<void> {
    await this.prisma.payoutMessage.updateMany({
      where: { id: messageId, status: 'processing' },
      data: { status, claimToken: null, lockedAt: null },
    });
  }

  private async settleDuplicateDelivery(
    tx: Prisma.TransactionClient,
    payoutId: string,
    messageId: string,
  ): Promise<void> {
    const current = await tx.payout.findUnique({ where: { id: payoutId } });
    if (
      current &&
      (current.status === 'completed' || current.status === 'failed' || current.status === 'needs_review')
    ) {
      await tx.payoutMessage.updateMany({
        where: { id: messageId, status: 'processing' },
        data: { status: current.status === 'needs_review' ? 'dead' : 'done', claimToken: null, lockedAt: null },
      });
    }
    // If the payout is still in-flight, a concurrent worker owns it; the
    // message stays 'processing' and stale recovery will retry.
  }

  private async markMessageDone(tx: Prisma.TransactionClient, messageId: string): Promise<void> {
    await tx.payoutMessage.updateMany({
      where: { id: messageId, status: 'processing' },
      data: { status: 'done', claimToken: null, lockedAt: null },
    });
  }
}
