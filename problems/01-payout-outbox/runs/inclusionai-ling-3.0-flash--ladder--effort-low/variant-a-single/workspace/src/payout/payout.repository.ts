import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  PayoutStatus,
  MessageStatus,
  LedgerType,
  MAX_RETRIES,
} from './payout.types';
import type { Payout, Message, Account, LedgerEntry } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- Account ---

  async findAccount(id: string): Promise<Account | null> {
    return this.prisma.account.findUnique({ where: { id } });
  }

  /**
   * Atomic reserve: increments reserved_balance iff (settled - reserved) >= amount.
   * Uses a single conditional UPDATE. Returns true only if the row was actually updated.
   */
  async reserveFunds(accountId: string, amount: bigint): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE accounts
      SET reserved_balance = reserved_balance + ${amount}
      WHERE id = ${accountId}
        AND (settled_balance - reserved_balance) >= ${amount}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async updateAccountBalances(
    accountId: string,
    settledDelta: bigint,
    reservedDelta: bigint,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE accounts
      SET settled_balance = settled_balance + ${settledDelta},
          reserved_balance = reserved_balance + ${reservedDelta}
      WHERE id = ${accountId}
    `;
  }

  // --- Payout ---

  async findByIdempotencyKey(key: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
  }

  async createPayout(data: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<Payout> {
    return this.prisma.payout.create({
      data: {
        ...data,
        status: PayoutStatus.CREATED,
      },
    });
  }

  async updatePayoutStatus(
    payoutId: string,
    status: PayoutStatus,
  ): Promise<Payout | null> {
    return this.prisma.payout.updateMany({
      where: { id: payoutId },
      data: { status },
    }).then((r: { count: number }) => (r.count > 0 ? this.prisma.payout.findUnique({ where: { id: payoutId } }) : null));
  }

  async findPayoutById(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  async incrementPayoutRetries(payoutId: string): Promise<void> {
    await this.prisma.payout.updateMany({
      where: { id: payoutId },
      data: { retries: { increment: 1 } },
    });
  }

  async findPayoutsByStatus(status: PayoutStatus): Promise<Payout[]> {
    return this.prisma.payout.findMany({ where: { status } });
  }

  // --- Message queue ---

  async createMessage(payoutId: string): Promise<Message> {
    return this.prisma.message.create({
      data: {
        payoutId,
        status: MessageStatus.PENDING,
        nextAttemptAt: new Date(),
      },
    });
  }

  /**
   * SELECT ... FOR UPDATE SKIP LOCKED — PostgreSQL-locked row claim.
   * Returns pending messages whose retry window has opened.
   */
  async claimPendingMessages(): Promise<Message[]> {
    return this.prisma.$queryRaw<Message[]>`
      SELECT m.* FROM messages m
      JOIN payouts p ON p.id = m.payoutId
      WHERE m.status = ${MessageStatus.PENDING}
        AND m.next_attempt_at <= NOW()
        AND p.status = ${PayoutStatus.CREATED}
      ORDER BY m.next_attempt_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `;
  }

  async markMessageProcessed(messageId: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: { id: messageId },
      data: { status: MessageStatus.PROCESSED },
    });
  }

  async markMessageFailed(messageId: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED },
    });
  }

  async scheduleRetry(messageId: string, attempts: number): Promise<void> {
    const backoffMs = Math.min(2 ** attempts * 1000, 30000);
    await this.prisma.message.updateMany({
      where: { id: messageId },
      data: {
        attempts,
        nextAttemptAt: new Date(Date.now() + backoffMs),
      },
    });
  }

  // --- Ledger ---

  async createLedgerEntry(data: {
    accountId: string;
    amount: bigint;
    type: LedgerType;
    payoutId?: string;
  }): Promise<LedgerEntry> {
    return this.prisma.ledgerEntry.create({
      data: {
        ...data,
      },
    });
  }

  // --- Payout status transitions for idempotent worker handling ---

  /**
   * Conditionally transition payout CREATED → PROCESSING.
   * Returns the payout if the transition happened (caller won the race), null otherwise.
   */
  async tryStartProcessing(payoutId: string): Promise<Payout | null> {
    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE payouts
      SET status = ${PayoutStatus.PROCESSING}, processed_at = NOW()
      WHERE id = ${payoutId} AND status = ${PayoutStatus.CREATED}
      RETURNING id
    `;
    if (result.length === 0) return null;
    return this.prisma.payout.findUnique({ where: { id: payoutId } });
  }

  /**
   * Mark payout as SENT with txHash inside a transaction.
   */
  async markSent(
    tx: PrismaService,
    payoutId: string,
    txHash: string,
    messageId: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE payouts
      SET status = ${PayoutStatus.SENT}, tx_hash = ${txHash}, processed_at = NOW()
      WHERE id = ${payoutId}
    `;
    await tx.message.updateMany({
      where: { id: messageId },
      data: { status: MessageStatus.PROCESSED },
    });
  }

  async markNeedsReview(payoutId: string): Promise<void> {
    await this.prisma.payout.updateMany({
      where: { id: payoutId },
      data: { status: PayoutStatus.NEEDS_REVIEW },
    });
  }

  async settlePayout(
    payoutId: string,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      // Debit settled balance, release reserved hold
      await tx.updateAccountBalances(accountId, -amount, -amount);

      // Ledger entry: money out on confirmation
      await tx.ledgerEntry.create({
        data: {
          accountId,
          amount: -amount,
          type: LedgerType.SETTLEMENT,
          payoutId,
        },
      });

      await tx.payout.updateMany({
        where: { id: payoutId },
        data: { status: PayoutStatus.COMPLETED, completedAt: new Date() },
      });
    });
  }

  async failPayout(
    payoutId: string,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      // Release the hold: reserved goes back down
      await tx.updateAccountBalances(accountId, 0, -amount);

      // Ledger entry: hold released
      await tx.ledgerEntry.create({
        data: {
          accountId,
          amount: amount,
          type: LedgerType.RELEASE,
          payoutId,
        },
      });

      await tx.payout.updateMany({
        where: { id: payoutId },
        data: { status: PayoutStatus.FAILED },
      });
    });
  }

  async resetDatabase(): Promise<void> {
    await this.prisma.$executeRaw`TRUNCATE accounts, ledger_entries, payouts, messages CASCADE`;
  }
}
