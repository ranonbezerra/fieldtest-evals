import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  PayoutStatus,
  MessageStatus,
  LedgerEntryType,
} from '@prisma/client';

export class InsufficientFundsError extends Error {
  code = 'insufficient_funds';
  constructor() {
    super('Account does not have sufficient available funds');
    this.name = 'InsufficientFundsError';
  }
}

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutResponse {
  id: string;
  accountId: string;
  amount: string;
  destinationAddress: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
}

type OutboxMessageRow = Prisma.OutboxMessageGetPayload<{}>;

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Runs `fn` inside a Prisma interactive transaction.
   * Used by the worker to group operations that must be atomic together.
   */
  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  /**
   * Atomically: lock account row, verify available funds, hold funds,
   * create payout + ledger entry + outbox message.
   */
  async createPayoutWithHold(input: CreatePayoutInput): Promise<PayoutResponse> {
    return this.prisma.$transaction(async (tx) => {
      // Row-level lock to prevent concurrent overdraw
      await tx.$queryRaw`SELECT 1 FROM accounts WHERE id = ${input.accountId}::uuid FOR UPDATE`;

      const account = await tx.account.findUniqueOrThrow({
        where: { id: input.accountId },
      });

      const available = account.settledBalance - account.heldAmount;
      if (available < input.amount) {
        throw new InsufficientFundsError();
      }

      await tx.account.update({
        where: { id: input.accountId },
        data: { heldAmount: { increment: input.amount } },
      });

      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          accountId: input.accountId,
          payoutId: payout.id,
          amount: input.amount,
          entryType: LedgerEntryType.HOLD,
        },
      });

      await tx.outboxMessage.create({
        data: { payoutId: payout.id },
      });

      return this.mapToResponse(payout);
    });
  }

  async findPayoutByIdempotencyKey(key: string): Promise<PayoutResponse | null> {
    const payout = await this.prisma.payout.findUnique({
      where: { idempotencyKey: key },
    });
    return payout ? this.mapToResponse(payout) : null;
  }

  async findPayoutById(id: string): Promise<PayoutResponse | null> {
    const payout = await this.prisma.payout.findUnique({
      where: { id },
    });
    return payout ? this.mapToResponse(payout) : null;
  }

  async updatePayoutStatus(
    id: string,
    status: PayoutStatus,
    txHash?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.payout.update({
      where: { id },
      data: {
        status,
        ...(txHash != null ? { txHash } : {}),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Records a SETTLE ledger entry and decrements both settled_balance and held_amount.
   * Must be called within a transaction (via `withTransaction`) together with
   * `updatePayoutStatus` and `markMessageDone` for atomicity.
   */
  async settleLedger(
    payoutId: string,
    accountId: string,
    amount: bigint,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.ledgerEntry.create({
      data: {
        accountId,
        payoutId,
        amount,
        entryType: LedgerEntryType.SETTLE,
      },
    });
    await client.account.update({
      where: { id: accountId },
      data: {
        settledBalance: { decrement: amount },
        heldAmount: { decrement: amount },
      },
    });
  }

  /**
   * Records a RELEASE ledger entry and decrements held_amount only.
   * Must be called within a transaction (via `withTransaction`) together with
   * `updatePayoutStatus` and `markMessageFailed` for atomicity.
   */
  async releaseHold(
    payoutId: string,
    accountId: string,
    amount: bigint,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.ledgerEntry.create({
      data: {
        accountId,
        payoutId,
        amount,
        entryType: LedgerEntryType.RELEASE,
      },
    });
    await client.account.update({
      where: { id: accountId },
      data: {
        heldAmount: { decrement: amount },
      },
    });
  }

  /**
   * Atomically claims a message by conditionally updating its status.
   * Returns true if this caller won the claim, false otherwise.
   */
  async claimMessage(messageId: string): Promise<boolean> {
    const result = await this.prisma.outboxMessage.updateMany({
      where: {
        id: messageId,
        status: { in: [MessageStatus.PENDING, MessageStatus.PROCESSING] },
      },
      data: {
        status: MessageStatus.PROCESSING,
        processingStartedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return result.count === 1;
  }

  /**
   * Finds messages stuck in PROCESSING state beyond the timeout threshold.
   */
  async claimStaleMessages(timeoutMs: number, limit: number): Promise<OutboxMessageRow[]> {
    const cutoff = new Date(Date.now() - timeoutMs);
    return this.prisma.outboxMessage.findMany({
      where: {
        status: MessageStatus.PROCESSING,
        processingStartedAt: { lt: cutoff },
      },
      take: limit,
    });
  }

  /**
   * Returns up to `limit` messages with status PENDING.
   */
  async nextPendingMessage(limit: number): Promise<OutboxMessageRow[]> {
    return this.prisma.outboxMessage.findMany({
      where: { status: MessageStatus.PENDING },
      take: limit,
    });
  }

  /**
   * Increments the attempt counter and resets the message to PENDING for retry.
   */
  async incrementAttempts(messageId: string, lastError?: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: {
        attempts: { increment: 1 },
        status: MessageStatus.PENDING,
        processingStartedAt: null,
        ...(lastError != null ? { lastError } : {}),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Marks a message as successfully processed (terminal).
   */
  async markMessageDone(messageId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.outboxMessage.update({
      where: { id: messageId },
      data: {
        status: MessageStatus.DONE,
        processingStartedAt: null,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Marks a message as permanently failed (terminal, retries exhausted).
   */
  async markMessageFailed(
    messageId: string,
    error: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.outboxMessage.update({
      where: { id: messageId },
      data: {
        status: MessageStatus.FAILED,
        lastError: error,
        processingStartedAt: null,
        updatedAt: new Date(),
      },
    });
  }

  private mapToResponse(payout: {
    id: string;
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    status: PayoutStatus;
    txHash: string | null;
    createdAt: Date;
  }): PayoutResponse {
    return {
      id: payout.id,
      accountId: payout.accountId,
      amount: payout.amount.toString(),
      destinationAddress: payout.destinationAddress,
      status: payout.status,
      txHash: payout.txHash,
      createdAt: payout.createdAt,
    };
  }
}
