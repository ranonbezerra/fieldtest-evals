import { Injectable } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LedgerEntryDto } from './dto-payout.js';
import { PayoutConfigService } from './payout.config.service.js';

export interface ClaimedMessage {
  id: bigint;
  payoutId: string;
  attemptCount: number;
}

@Injectable()
export class PayoutRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PayoutConfigService,
  ) {}

  account(accountId: string, initialBalance = 0n) {
    return this.prisma.account.upsert({
      where: { id: accountId },
      update: {},
      create: { id: accountId, accountNumber: accountId, balance: initialBalance },
    });
  }

  async findPayoutByIdempotencyKey(accountId: string, idempotencyKey: string) {
    return this.prisma.payout.findUnique({
      where: { idempotencyKey },
    });
  }

  async findPayoutById(id: string) {
    return this.prisma.payout.findUnique({
      where: { id },
    });
  }

  async listPayouts(limit: number, offset: number) {
    return this.prisma.payout.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Creates the payout, debits the available balance, posts the hold ledger
   * batch and enqueues the outbox message — all in one transaction. The debit
   * is a conditional row update, so two racing requests can never both
   * succeed.
   */
  async createWithDebit(
    input: {
      accountId: string;
      amount: bigint;
      destinationAddress: string;
      idempotencyKey: string;
    },
    holdEntries: LedgerEntryDto[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Debit only if funds are available. The row lock serialises racers.
      const debited = await tx.account.updateMany({
        where: { id: input.accountId, balance: { gte: input.amount } },
        data: { balance: { decrement: input.amount } },
      });
      if (debited.count === 0) return { ok: false as const };

      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: PayoutStatus.created,
        },
      });

      await tx.ledgerEntry.createMany({
        data: holdEntries.map((e) => ({
          batchId: e.batchId,
          entryType: e.entryType,
          accountId: e.accountId,
          amount: e.amount,
          memo: e.memo ?? null,
        })),
      });

      await tx.outboxMessage.create({
        data: { payoutId: payout.id },
      });

      return { ok: true as const, payout };
    });
  }

  /**
   * Atomically claims the next due pending message (single-winner conditional
   * update) and moves its payout to processing.
   */
  async claimMessage(now: Date): Promise<ClaimedMessage | null> {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.outboxMessage.findFirst({
        where: { status: 'pending', nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        select: { id: true },
      });
      if (!candidate) return null;

      const claimed = await tx.outboxMessage.updateMany({
        where: { id: candidate.id, status: 'pending' },
        data: { status: 'processing', attemptCount: { increment: 1 } },
      });
      if (claimed.count === 0) return null;

      const message = await tx.outboxMessage.findUniqueOrThrow({
        where: { id: candidate.id },
      });
      await tx.payout.updateMany({
        where: { id: message.payoutId, status: PayoutStatus.created },
        data: { status: PayoutStatus.processing },
      });
      return { id: message.id, payoutId: message.payoutId, attemptCount: message.attemptCount };
    });
  }

  /**
   * Provider confirmed. Posts the settlement batch and marks the payout sent.
   * The conditional update makes repeated deliveries no-ops.
   */
  async completeSent(
    payoutId: string,
    txHash: string,
    settlementEntries: LedgerEntryDto[],
    sentAt: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payout.updateMany({
        where: { id: payoutId, status: PayoutStatus.processing },
        data: { status: PayoutStatus.sent, txHash, sentAt },
      });
      if (updated.count === 0) return false;

      await tx.ledgerEntry.createMany({
        data: settlementEntries.map((e) => ({
          batchId: e.batchId,
          entryType: e.entryType,
          accountId: e.accountId,
          amount: e.amount,
          memo: e.memo ?? null,
        })),
      });
      return true;
    });
  }

  /**
   * Definitive provider failure. Posts the reversal batch (funds return to
   * available balance) and marks the payout failed.
   */
  async failFinal(payoutId: string, reversalEntries: LedgerEntryDto[]): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payout.updateMany({
        where: { id: payoutId, status: PayoutStatus.processing },
        data: { status: PayoutStatus.failed },
      });
      if (updated.count === 0) return false;

      await tx.ledgerEntry.createMany({
        data: reversalEntries.map((e) => ({
          batchId: e.batchId,
          entryType: e.entryType,
          accountId: e.accountId,
          amount: e.amount,
          memo: e.memo ?? null,
        })),
      });
      return true;
    });
  }

  async markRetry(messageId: bigint, nextAttemptAt: Date): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'pending', nextAttemptAt },
    });
  }

  /**
   * Bounded retries exhausted without a definitive outcome. Funds stay
   * reserved (the hold ledger entry remains) and the payout needs review.
   */
  async exhaust(messageId: bigint, payoutId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'dead' },
      });
      await tx.payout.updateMany({
        where: { id: payoutId, status: PayoutStatus.processing },
        data: { status: PayoutStatus.needs_review },
      });
    });
  }

  async markMessageHandled(messageId: bigint): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'handled' },
    });
  }
}
