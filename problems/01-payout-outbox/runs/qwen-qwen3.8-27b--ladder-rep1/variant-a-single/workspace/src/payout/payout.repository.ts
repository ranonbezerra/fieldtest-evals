import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Payout } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreatePayoutInput {
  accountId: string;
  /** Minor units. */
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export type CreatePayoutResult =
  | { status: 'created'; payout: Payout }
  | { status: 'duplicate'; payout: Payout }
  | { status: 'account_not_found' }
  | { status: 'insufficient_funds'; available: bigint };

const CUSTOMER_FUNDS = 'customer_funds';
const PAYOUTS_PENDING = 'payouts_pending';
const PAID_OUT = 'paid_out';

class SettlementInvariantError extends Error {}

@Injectable()
export class PayoutRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Reserves the funds, creates the payout, enqueues the transfer message and
   * posts the balanced reservation ledger legs — all in one transaction.
   *
   * The balance check and the reservation are a single conditional UPDATE; the
   * caller observes how many rows changed, so racing requests serialize on the
   * row lock and exactly one wins. The unique (accountId, idempotencyKey)
   * constraint is the idempotency guard: a racing duplicate fails with P2002,
   * rolls its own transaction (including its reservation) back, and the
   * original payout is returned.
   */
  async createPayoutAtomic(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.account.findUnique({ where: { id: input.accountId } });
        if (!account) {
          return { status: 'account_not_found' } as CreatePayoutResult;
        }

        const reserved = await tx.account.updateMany({
          where: { id: input.accountId, availableMinorUnits: { gte: input.amount } },
          data: {
            availableMinorUnits: { decrement: input.amount },
            reservedMinorUnits: { increment: input.amount },
          },
        });
        if (reserved.count !== 1) {
          const fresh = await tx.account.findUnique({ where: { id: input.accountId } });
          return { status: 'insufficient_funds', available: fresh?.availableMinorUnits ?? 0n } as CreatePayoutResult;
        }

        const payout = await tx.payout.create({
          data: {
            accountId: input.accountId,
            amountMinorUnits: input.amount,
            destinationAddress: input.destinationAddress,
            idempotencyKey: input.idempotencyKey,
          },
        });

        // The outbox message is in the same transaction as the reservation.
        await tx.message.create({ data: { payoutId: payout.id, kind: 'payout.transfer' } });

        const entryId = randomUUID();
        await tx.ledgerEntry.createMany({
          data: [
            { entryId, payoutId: payout.id, accountId: input.accountId, accountName: CUSTOMER_FUNDS, amountMinorUnits: -input.amount },
            { entryId, payoutId: payout.id, accountId: input.accountId, accountName: PAYOUTS_PENDING, amountMinorUnits: input.amount },
          ],
        });

        return { status: 'created', payout } as CreatePayoutResult;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.payout.findUnique({
          where: {
            accountId_idempotencyKey: { accountId: input.accountId, idempotencyKey: input.idempotencyKey },
          },
        });
        if (existing) {
          return { status: 'duplicate', payout: existing } as CreatePayoutResult;
        }
      }
      throw error;
    }
  }

  findPayout(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  findMessageWithPayout(messageId: string) {
    return this.prisma.message.findUnique({ where: { id: messageId }, include: { payout: true } });
  }

  /**
   * Guarded status transition: applies only while the payout is still in
   * `from`. Returns true when this caller won the transition.
   */
  async transitionPayout(
    id: string,
    from: string,
    to: string,
    data?: Prisma.PayoutUpdateManyMutationInput,
  ): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: { id, status: from },
      data: { status: to, ...(data ?? {}) },
    });
    return result.count === 1;
  }

  async recordAttempt(
    id: string,
    patch: { attempts?: number; attemptState?: string; errorMessage?: string | null },
  ): Promise<void> {
    await this.prisma.payout.update({ where: { id }, data: { ...patch } });
  }

  async recordTxHash(id: string, txHash: string): Promise<void> {
    await this.prisma.payout.update({ where: { id }, data: { txHash } });
  }

  /**
   * Claims up to `limit` messages: due `pending` messages plus `processing`
   * messages whose lease expired (worker died mid-call). Each claim is a
   * conditional UPDATE, so two workers can never claim the same message.
   */
  async claimMessages(now: Date, leaseCutoff: Date, limit: number): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.message.findMany({
        where: { status: 'pending', nextTryAt: { lte: now } },
        orderBy: [{ nextTryAt: 'asc' }, { createdAt: 'asc' }],
        take: limit,
      });
      const expired = await tx.message.findMany({
        where: { status: 'processing', leasedAt: { lt: leaseCutoff } },
        orderBy: { leasedAt: 'asc' },
        take: limit,
      });

      const claimed: string[] = [];
      for (const message of [...due, ...expired]) {
        const where: Prisma.MessageWhereInput =
          message.status === 'pending'
            ? { id: message.id, status: 'pending' }
            : { id: message.id, status: 'processing', leasedAt: { lt: leaseCutoff } };
        const result = await tx.message.updateMany({
          where,
          data: { status: 'processing', leasedAt: now },
        });
        if (result.count === 1) {
          claimed.push(message.id);
        }
      }
      return claimed;
    });
  }

  async requeueMessage(id: string, nextTryAt: Date): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status: 'pending', leasedAt: null, nextTryAt },
    });
  }

  async markMessageDone(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status: 'done', leasedAt: null },
    });
  }

  findSentPayouts(limit: number): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { status: 'sent' },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
  }

  /**
   * The only place where `settled_minor_units` moves. The guarded
   * `sent -> completed` transition is the exactly-once token; the account
   * debit and the balanced ledger legs are in the same transaction.
   */
  async settlePayout(payoutId: string): Promise<'settled' | 'skipped' | 'parked'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const moved = await tx.payout.updateMany({
          where: { id: payoutId, status: 'sent' },
          data: { status: 'completed' },
        });
        if (moved.count !== 1) {
          return 'skipped' as const;
        }
        const payout = await tx.payout.findUnique({ where: { id: payoutId } });
        if (!payout) {
          throw new SettlementInvariantError('payout vanished mid-settlement');
        }
        const account = await tx.account.updateMany({
          where: { id: payout.accountId, reservedMinorUnits: { gte: payout.amountMinorUnits } },
          data: {
            reservedMinorUnits: { decrement: payout.amountMinorUnits },
            settledMinorUnits: { decrement: payout.amountMinorUnits },
          },
        });
        if (account.count !== 1) {
          // Cannot happen while every reservation is honoured, but if it ever
          // did we roll the status back and let a human look — never debit.
          throw new SettlementInvariantError('reserved balance below payout amount at settlement');
        }
        const entryId = randomUUID();
        await tx.ledgerEntry.createMany({
          data: [
            { entryId, payoutId, accountId: payout.accountId, accountName: PAYOUTS_PENDING, amountMinorUnits: -payout.amountMinorUnits },
            { entryId, payoutId, accountId: payout.accountId, accountName: PAID_OUT, amountMinorUnits: payout.amountMinorUnits },
          ],
        });
        return 'settled' as const;
      });
    } catch (error) {
      if (error instanceof SettlementInvariantError) {
        await this.prisma.payout.updateMany({
          where: { id: payoutId, status: 'sent' },
          data: { status: 'needs_review', errorMessage: error.message },
        });
        return 'parked';
      }
      throw error;
    }
  }
}
