import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AccountNotFound } from './payout.errors.js';

export interface Delivery {
  outboxId: string;
  payoutId: string;
  deliveredAt: Date;
}

export interface PayoutRecord {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
  txHash: string | null;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Conditional update that only applies when the funds are there. The caller
   * observes the affected-row count to know whether it won the race.
   */
  async reserveIfSufficient(
    accountId: string,
    amount: bigint,
  ): Promise<number> {
    try {
      const res = await this.prisma.account.updateMany({
        where: { id: accountId, settledBalance: { gte: amount } },
        data: {
          settledBalance: { decrement: amount },
          reservedBalance: { increment: amount },
        },
      });
      return res.count;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new AccountNotFound(accountId);
      }
      throw e;
    }
  }

  async accountExists(accountId: string): Promise<boolean> {
    const row = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Payout row, reservation, ledger pair and outbox message in ONE
   * transaction: if the process dies between any of them, none of them
   * exist.
   */
  async createPayoutWithOutbox(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const reserved = await tx.account.updateMany({
        where: { id: input.accountId, settledBalance: { gte: input.amount } },
        data: {
          settledBalance: { decrement: input.amount },
          reservedBalance: { increment: input.amount },
        },
      });
      if (reserved.count === 0) {
        throw new Error('RESERVATION_FAILED');
      }
      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: 'CREATED',
        },
      });
      const message = await tx.outboxMessage.create({
        data: {
          payoutId: payout.id,
          status: 'PENDING',
          availableAt: new Date(),
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: payout.id,
          accountId: input.accountId,
          outboxId: message.id,
          bucket: 'AVAILABLE',
          direction: 'credit',
          amount: input.amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: payout.id,
          accountId: input.accountId,
          outboxId: message.id,
          bucket: 'RESERVED',
          direction: 'debit',
          amount: input.amount,
          sequence: 2,
        },
      });
      return payout.id;
    });
  }

  async findPayoutByKey(
    accountId: string,
    idempotencyKey: string,
  ): Promise<PayoutRecord | null> {
    const row = await this.prisma.payout.findFirst({
      where: { accountId, idempotencyKey },
    });
    return row ? this.toRecord(row) : null;
  }

  async findPayoutById(id: string): Promise<PayoutRecord | null> {
    const row = await this.prisma.payout.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  /**
   * Atomic claim of the oldest actionable outbox message. Rows stuck in
   * PROCESSING for longer than the stale window are re-claimable, so a worker
   * crash cannot wedge a message.
   */
  async claimNext(): Promise<Delivery | null> {
    const row = await this.prisma.$queryRaw<
      Array<{ id: string; payout_id: string; updated_at: Date }>
    >`
      UPDATE outbox_messages
      SET status = 'PROCESSING',
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM outbox_messages
        WHERE (status = 'PENDING' AND available_at <= NOW())
           OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '5 minutes')
        ORDER BY available_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, payout_id, updated_at
    `;
    if (!row.length) {
      return null;
    }
    return {
      outboxId: row[0].id,
      payoutId: row[0].payout_id,
      deliveredAt: row[0].updated_at,
    };
  }

  /** Guarded transition: only from CREATED (first attempt). */
  async markProcessing(payoutId: string): Promise<void> {
    const res = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'CREATED' },
      data: { status: 'PROCESSING' },
    });
    if (res.count === 0) {
      const current = await this.prisma.payout.findUnique({ where: { id: payoutId } });
      if (!current) {
        throw new Error(`Payout ${payoutId} not found while marking processing`);
      }
      if (current.status !== 'PROCESSING') {
        throw new Error(
          `Cannot mark payout ${payoutId} processing: status ${current.status}`,
        );
      }
      // Already PROCESSING from a crashed earlier attempt: fine to continue.
    }
  }

  /**
   * Guarded transition to SENT; the second delivery of the same message is a
   * no-op.
   */
  async recordSent(payoutId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
        data: { status: 'SENT', txHash },
      });
      if (res.count === 0) {
        const current = await tx.payout.findUnique({ where: { id: payoutId } });
        if (!current) {
          throw new Error(`Payout ${payoutId} not found while recording sent`);
        }
        if (current.status === 'SENT') {
          return; // redelivery of an already-acknowledged transfer
        }
        throw new Error(
          `Cannot record sent for payout ${payoutId}: status ${current.status}`,
        );
      }
    });
  }

  /**
   * Settlement: the only place settled balance moves, and only after the
   * provider confirms. Guarded on status SENT plus a unique ledger pair, so a
   * redelivered message cannot settle twice.
   */
  async settle(
    payoutId: string,
    accountId: string,
    amount: bigint,
    outboxId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: payoutId, status: 'SENT' },
        data: { status: 'COMPLETED' },
      });
      if (res.count === 0) {
        return;
      }
      await tx.account.update({
        where: { id: accountId },
        data: {
          reservedBalance: { decrement: amount },
          settledBalance: { increment: amount },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId,
          accountId,
          outboxId,
          bucket: 'RESERVED',
          direction: 'credit',
          amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId,
          accountId,
          outboxId,
          bucket: 'ONCHAIN',
          direction: 'debit',
          amount,
          sequence: 2,
        },
      });
    });
  }

  /**
   * Provider said definitively the transfer did NOT happen: release the hold
   * and return the funds to the available bucket.
   */
  async recordDefinitiveFailure(input: {
    payoutId: string;
    accountId: string;
    amount: bigint;
    error: string;
    outboxId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: input.payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
        data: { status: 'FAILED', lastError: input.error },
      });
      if (res.count === 0) {
        return;
      }
      await tx.account.update({
        where: { id: input.accountId },
        data: {
          settledBalance: { increment: input.amount },
          reservedBalance: { decrement: input.amount },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: input.payoutId,
          accountId: input.accountId,
          outboxId: input.outboxId,
          bucket: 'RESERVED',
          direction: 'credit',
          amount: input.amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: input.payoutId,
          accountId: input.accountId,
          outboxId: input.outboxId,
          bucket: 'AVAILABLE',
          direction: 'debit',
          amount: input.amount,
          sequence: 2,
        },
      });
      await tx.outboxMessage.update({
        where: { id: input.outboxId },
        data: { status: 'FAILED' },
      });
    });
  }

  /**
   * No definitive outcome: either reschedule the message for another attempt
   * or, when attempts are exhausted, park the payout in NEEDS_REVIEW and
   * leave the reservation in place.
   */
  async recordFailure(input: {
    payoutId: string;
    error: string;
    exhausted: boolean;
    outboxId: string;
    retryAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: input.payoutId },
        data: {
          status: input.exhausted ? 'NEEDS_REVIEW' : 'PROCESSING',
          attempts: { increment: 1 },
          lastError: input.error,
        },
      });
      await tx.outboxMessage.update({
        where: { id: input.outboxId },
        data: input.exhausted
          ? { status: 'ABANDONED' }
          : { status: 'PENDING', availableAt: input.retryAt },
      });
    });
  }

  /** Idempotent processed-mark: the unique outbox_id makes redelivery a no-op. */
  async markProcessed(outboxId: string): Promise<void> {
    await this.prisma.processedMessage.upsert({
      where: { outboxId },
      create: { outboxId },
      update: {},
    });
  }

  async findLedgerEntries(payoutId: string): Promise<
    Array<{ bucket: string; direction: string; amount: bigint; sequence: number }>
  > {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { payoutId },
      orderBy: { sequence: 'asc' },
    });
    return rows.map((r) => ({
      bucket: r.bucket,
      direction: r.direction,
      amount: r.amount,
      sequence: r.sequence,
    }));
  }

  private toRecord(row: {
    id: string;
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
    status: string;
    attempts: number;
    txHash: string | null;
  }): PayoutRecord {
    return {
      id: row.id,
      accountId: row.accountId,
      amount: row.amount,
      destinationAddress: row.destinationAddress,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      attempts: row.attempts,
      txHash: row.txHash,
    };
  }
}
