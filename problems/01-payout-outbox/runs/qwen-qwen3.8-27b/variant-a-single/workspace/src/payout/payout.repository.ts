import { Inject, Injectable } from '@nestjs/common';
import {
  LedgerBucket,
  LedgerSide,
  OutboxKind,
  OutboxStatus,
  Payout,
  Prisma,
  PrismaClient,
  $Enums,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ClaimedMessage {
  id: string;
  kind: OutboxKind;
  refId: string;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: Date;
}

export interface LedgerEntryInput {
  payoutId: string | null;
  accountId: string;
  bucket: LedgerBucket;
  side: LedgerSide;
  amount: bigint;
}

export interface MessagePatch {
  status?: OutboxStatus;
  retryCount?: number;
  nextAttemptAt?: Date;
  lastError?: string | null;
}

/** The only layer that touches the database. */
@Injectable()
export class PayoutRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  async accountExists(accountId: string): Promise<boolean> {
    const row = await this.prisma.account.findUnique({ where: { id: accountId }, select: { id: true } });
    return row !== null;
  }

  /**
   * Guarded atomic reservation: availability check and increment in one statement.
   * Postgres serializes the racing UPDATEs on the account row lock, so two
   * concurrent requests can never both pass the availability check.
   */
  async reserveFundsTx(tx: Prisma.TransactionClient, accountId: string, amount: bigint): Promise<boolean> {
    const affected = await tx.$executeRaw`
      UPDATE "accounts"
      SET "reserved_balance" = "reserved_balance" + ${amount.toString()}::bigint
      WHERE "id" = ${accountId}
        AND "settled_balance" - "reserved_balance" >= ${amount.toString()}::bigint
    `;
    return affected > 0;
  }

  async getAvailableBalanceTx(tx: Prisma.TransactionClient, accountId: string): Promise<bigint | null> {
    const rows = await tx.$queryRaw<Array<{ available: bigint }>>`
      SELECT "settled_balance" - "reserved_balance" AS "available"
      FROM "accounts"
      WHERE "id" = ${accountId}
    `;
    return rows[0]?.available ?? null;
  }

  async findPayoutByIdempotencyKey(idempotencyKey: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { idempotencyKey } });
  }

  async findPayout(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  async createPayoutTx(
    tx: Prisma.TransactionClient,
    data: { accountId: string; idempotencyKey: string; destinationAddress: string; amount: bigint },
  ): Promise<Payout> {
    return tx.payout.create({ data: { ...data, status: 'created' } });
  }

  async createMessageTx(tx: Prisma.TransactionClient, data: { kind: OutboxKind; refId: string }): Promise<void> {
    await tx.outboxMessage.create({ data });
  }

  async createLedgerEntriesTx(tx: Prisma.TransactionClient, entries: LedgerEntryInput[]): Promise<void> {
    await tx.ledgerEntry.createMany({ data: entries });
  }

  /** Compare-and-set on payout status; false means the transition was lost to a concurrent decision. */
  async compareAndSetPayoutTx(
    tx: Prisma.TransactionClient,
    id: string,
    fromStatuses: $Enums.PayoutStatus[],
    data: Prisma.PayoutUpdateInput,
  ): Promise<boolean> {
    const { count } = await tx.payout.updateMany({ where: { id, status: { in: fromStatuses } }, data });
    return count > 0;
  }

  async adjustBalancesTx(
    tx: Prisma.TransactionClient,
    accountId: string,
    delta: { settled?: bigint; reserved?: bigint },
  ): Promise<void> {
    await tx.account.update({
      where: { id: accountId },
      data: {
        ...(delta.settled !== undefined ? { settledBalance: { decrement: delta.settled } } : {}),
        ...(delta.reserved !== undefined ? { reservedBalance: { decrement: delta.reserved } } : {}),
      },
    });
  }

  async patchMessageTx(tx: Prisma.TransactionClient, id: string, patch: MessagePatch): Promise<void> {
    await tx.outboxMessage.update({ where: { id }, data: patch });
  }

  /**
   * Atomically claim one due message. `FOR UPDATE SKIP LOCKED` guarantees two
   * pollers never claim the same row; a message stuck in `processing` past the
   * lease becomes re-claimable (crashed worker), which is what makes delivery
   * at-least-once.
   */
  async claimNextDueMessage(leaseMs: number): Promise<ClaimedMessage | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        kind: string;
        ref_id: string;
        retry_count: number;
        last_error: string | null;
        next_attempt_at: Date;
      }>
    >`
      UPDATE "outbox_messages"
      SET "status" = 'processing', "updated_at" = NOW()
      WHERE "id" IN (
        SELECT "id"
        FROM "outbox_messages"
        WHERE ("status" = 'pending' AND "next_attempt_at" <= NOW())
           OR ("status" = 'processing' AND "updated_at" <= NOW() - make_interval(msecs => ${leaseMs.toString()}::int8))
        ORDER BY "created_at"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "kind", "ref_id", "retry_count", "last_error", "next_attempt_at"
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind as OutboxKind,
      refId: row.ref_id,
      retryCount: row.retry_count,
      lastError: row.last_error,
      nextAttemptAt: row.next_attempt_at,
    };
  }
}
