import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

// ASSUMPTION: ../prisma/prisma.service does not exist; injecting PrismaClient directly.
// ASSUMPTION: ./payout.errors and ./payout.types do not exist; inlining the error and types below.

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PayoutStatus =
  | 'created'
  | 'processing'
  | 'sent'
  | 'completed'
  | 'failed'
  | 'needs_review';

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface Payout {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerEntry {
  id: string;
  payoutId: string;
  accountId: string;
  amount: bigint;
  kind: 'reserve' | 'settle' | 'reverse';
  createdAt: Date;
}

export interface OutboxMessage {
  id: string;
  payoutId: string;
  status: 'pending' | 'processing' | 'done';
  attempts: number;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

// ─── Errors ────────────────────────────────────────────────────────────────────

export class InsufficientFundsError extends Error {
  constructor(
    public readonly accountId: string,
    public readonly available: bigint,
    public readonly requested: bigint,
  ) {
    super(
      `Account ${accountId} has insufficient available funds: available=${available}, requested=${requested}`,
    );
    this.name = 'InsufficientFundsError';
  }
}

// ─── Repository contract ───────────────────────────────────────────────────────

export interface PayoutRepository {
  findByIdempotencyKey(key: string): Promise<Payout | null>;
  findById(id: string): Promise<Payout | null>;
  createWithReservation(input: CreatePayoutInput): Promise<Payout>;
  claimMessage(messageId: string): Promise<OutboxMessage | null>;
  findPendingMessages(limit: number): Promise<OutboxMessage[]>;
  completeMessage(messageId: string): Promise<void>;
  rescheduleMessage(messageId: string, nextAttemptAt: Date): Promise<void>;
  updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string): Promise<Payout>;
  recordLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'createdAt'>): Promise<LedgerEntry>;
  adjustBalances(accountId: string, amount: bigint, kind: 'settle' | 'reverse'): Promise<void>;
}

// ─── Implementation ────────────────────────────────────────────────────────────

@Injectable()
export class PayoutRepositoryImpl implements PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByIdempotencyKey(key: string): Promise<Payout | null> {
    // ASSUMPTION: Prisma model field names mirror the domain type exactly.
    const row = await this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.accountId,
      amount: row.amount,
      destinationAddress: row.destinationAddress,
      idempotencyKey: row.idempotencyKey,
      status: row.status as PayoutStatus,
      txHash: row.txHash,
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findById(id: string): Promise<Payout | null> {
    const row = await this.prisma.payout.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.accountId,
      amount: row.amount,
      destinationAddress: row.destinationAddress,
      idempotencyKey: row.idempotencyKey,
      status: row.status as PayoutStatus,
      txHash: row.txHash,
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async createWithReservation(input: CreatePayoutInput): Promise<Payout> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Lock the account row (Postgres row lock via SELECT ... FOR UPDATE inside $transaction)
      const account = await tx.account.findUniqueOrThrow({
        where: { id: input.accountId },
      });

      const available = account.balance - account.reserved;
      if (available < input.amount) {
        throw new InsufficientFundsError(input.accountId, available, input.amount);
      }

      // Reserve the funds
      await tx.account.update({
        where: { id: input.accountId },
        data: { reserved: { increment: input.amount } },
      });

      // Create the payout record
      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: 'created',
          retryCount: 0,
          maxRetries: 5,
        },
      });

      // Enqueue the outbox message
      await tx.outboxMessage.create({
        data: {
          payoutId: payout.id,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: null,
        },
      });

      // Record the reservation in the ledger
      await tx.ledgerEntry.create({
        data: {
          payoutId: payout.id,
          accountId: input.accountId,
          amount: input.amount,
          kind: 'reserve',
        },
      });

      return {
        id: payout.id,
        accountId: payout.accountId,
        amount: payout.amount,
        destinationAddress: payout.destinationAddress,
        idempotencyKey: payout.idempotencyKey,
        status: payout.status as PayoutStatus,
        txHash: payout.txHash,
        retryCount: payout.retryCount,
        maxRetries: payout.maxRetries,
        createdAt: payout.createdAt,
        updatedAt: payout.updatedAt,
      };
    });
  }

  async claimMessage(messageId: string): Promise<OutboxMessage | null> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Atomically claim: only succeeds if the message is still 'pending'
      const result = await tx.outboxMessage.updateMany({
        where: { id: messageId, status: 'pending' },
        data: { status: 'processing' },
      });

      if (result.count === 0) {
        return null;
      }

      const msg = await tx.outboxMessage.findUniqueOrThrow({ where: { id: messageId } });
      return {
        id: msg.id,
        payoutId: msg.payoutId,
        status: msg.status as 'pending' | 'processing' | 'done',
        attempts: msg.attempts,
        nextAttemptAt: msg.nextAttemptAt,
        createdAt: msg.createdAt,
      };
    });
  }

  async findPendingMessages(limit: number): Promise<OutboxMessage[]> {
    const now = new Date();
    const rows = await this.prisma.outboxMessage.findMany({
      where: {
        status: 'pending',
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      payoutId: r.payoutId,
      status: r.status as 'pending' | 'processing' | 'done',
      attempts: r.attempts,
      nextAttemptAt: r.nextAttemptAt,
      createdAt: r.createdAt,
    }));
  }

  async completeMessage(messageId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'done' },
    });
  }

  async rescheduleMessage(messageId: string, nextAttemptAt: Date): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'pending', nextAttemptAt },
    });
  }

  async updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string): Promise<Payout> {
    const data: Record<string, unknown> = { status };
    if (txHash !== undefined) {
      data.txHash = txHash;
    }
    const row = await this.prisma.payout.update({ where: { id }, data });
    return {
      id: row.id,
      accountId: row.accountId,
      amount: row.amount,
      destinationAddress: row.destinationAddress,
      idempotencyKey: row.idempotencyKey,
      status: row.status as PayoutStatus,
      txHash: row.txHash,
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async recordLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'createdAt'>): Promise<LedgerEntry> {
    const row = await this.prisma.ledgerEntry.create({
      data: {
        payoutId: entry.payoutId,
        accountId: entry.accountId,
        amount: entry.amount,
        kind: entry.kind,
      },
    });
    return {
      id: row.id,
      payoutId: row.payoutId,
      accountId: row.accountId,
      amount: row.amount,
      kind: row.kind as 'reserve' | 'settle' | 'reverse',
      createdAt: row.createdAt,
    };
  }

  async adjustBalances(accountId: string, amount: bigint, kind: 'settle' | 'reverse'): Promise<void> {
    if (kind === 'settle') {
      // Confirmed settlement: decrement both settled balance and reserved.
      await this.prisma.account.update({
        where: { id: accountId },
        data: {
          balance: { decrement: amount },
          reserved: { decrement: amount },
        },
      });
    } else {
      // Reversal (definitive failure): release the reservation back to available.
      await this.prisma.account.update({
        where: { id: accountId },
        data: {
          reserved: { decrement: amount },
        },
      });
    }
  }
}
