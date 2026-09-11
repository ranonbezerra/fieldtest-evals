import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type Payout } from '@prisma/client';
import { AccountNotFoundError, InsufficientFundsError } from '../common/service-error.js';

export interface CreatePayoutInput {
  accountId: string;
  amountMinor: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface ClaimedMessage {
  id: string;
  payload: unknown;
  attempts: number;
}

/**
 * The only layer that touches the database.
 *
 * Raw SQL is used where the Prisma query API cannot express what funds safety
 * requires: row locking (`FOR UPDATE`), atomic conditional state transitions
 * (`UPDATE ... WHERE status = ... RETURNING`), and queue claiming with
 * `FOR UPDATE SKIP LOCKED`.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create a payout, reserve the funds, write the hold ledger entries, and queue
   * the outbox message — all in one transaction. `FOR UPDATE` on the account
   * row serializes concurrent creations, so the available-funds guard is
   * race-free and a retried idempotency key can never reserve twice.
   */
  async createPayout(input: CreatePayoutInput): Promise<{ payout: Payout; replayed: boolean }> {
    try {
      return await this.createPayoutTx(input);
    } catch (err) {
      // Backstop: a same-key transaction committed after our lock read (rare;
      // the row lock normally prevents it). Our transaction rolled back —
      // nothing was reserved — so one retry returns the existing payout.
      if (isUniqueViolation(err)) {
        return this.createPayoutTx(input);
      }
      throw err;
    }
  }

  private async createPayoutTx(input: CreatePayoutInput): Promise<{ payout: Payout; replayed: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize all concurrent creations for this account on the account row.
      const locked = await tx.$queryRaw<
        Array<{ settled_balance_minor: bigint | string; held_balance_minor: bigint | string }>
      >`
        SELECT settled_balance_minor, held_balance_minor
        FROM accounts
        WHERE id = ${input.accountId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new AccountNotFoundError(input.accountId);
      }

      // Idempotent replay: an existing payout with this (account, key) is
      // returned as-is and nothing is reserved again.
      const existing = await tx.payout.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: input.accountId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing !== null) {
        return { payout: existing, replayed: true };
      }

      const available = toBigInt(locked[0].settled_balance_minor) - toBigInt(locked[0].held_balance_minor);
      if (available < input.amountMinor) {
        throw new InsufficientFundsError(available, input.amountMinor);
      }

      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amountMinor: input.amountMinor,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: 'CREATED',
        },
      });

      // Hold: move the amount from available to held. The settled total is
      // unchanged; only availability drops.
      await tx.account.update({
        where: { id: input.accountId },
        data: { heldBalanceMinor: { increment: input.amountMinor }, version: { increment: 1 } },
      });

      // Double-entry hold (one balanced group): debit the user's available
      // funds, credit the user's held sub-account.
      const groupId = `${payout.id}:created`;
      await tx.ledgerEntry.createMany({
        data: [
          { groupId, payoutId: payout.id, account: 'USER_AVAILABLE', direction: 'DEBIT', amountMinor: input.amountMinor },
          { groupId, payoutId: payout.id, account: 'USER_HELD', direction: 'CREDIT', amountMinor: input.amountMinor },
        ],
      });

      // Outbox: the message is committed with the payout, so a committed payout
      // always has a queued message — no lost transfers, and no transfer in
      // the request path.
      await tx.outboxMessage.create({
        data: { type: 'payout.process', payload: { payoutId: payout.id } },
      });

      return { payout, replayed: false };
    });
  }

  findPayoutById(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  /** Conditional CREATED → PROCESSING; false if the payout already advanced. */
  async beginProcessing(payoutId: string): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'CREATED' },
      data: { status: 'PROCESSING' },
    });
    return result.count > 0;
  }

  /**
   * Provider confirmed the transfer. Records the tx hash, settles the ledger
   * (held → payouts sent; the settled balance is debited here and only here),
   * and acks the message — atomically.
   */
  async recordSent(payoutId: string, txHash: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; account_id: string; amount_minor: bigint | string }>>`
        UPDATE "payouts"
        SET status = 'SENT', tx_hash = ${txHash}, sent_at = now()
        WHERE id = ${payoutId} AND status = 'PROCESSING'
        RETURNING id, account_id, amount_minor
      `;
      if (rows.length === 0) {
        throw new Error(`cannot record sent for payout ${payoutId}: it is not in PROCESSING state`);
      }
      const { account_id: accountId, amount_minor: rawAmount } = rows[0];
      const amount = toBigInt(rawAmount);

      await tx.ledgerEntry.createMany({
        data: [
          { groupId: `${payoutId}:sent`, payoutId, account: 'USER_HELD', direction: 'DEBIT', amountMinor: amount },
          { groupId: `${payoutId}:sent`, payoutId, account: 'PAYOUTS_SENT', direction: 'CREDIT', amountMinor: amount },
        ],
      });

      await tx.account.update({
        where: { id: accountId },
        data: {
          settledBalanceMinor: { decrement: amount },
          heldBalanceMinor: { decrement: amount },
          version: { increment: 1 },
        },
      });

      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'DONE', completedAt: new Date() },
      });
    });
  }

  /** Conditional SENT → COMPLETED; false if the payout is no longer SENT. */
  async markCompleted(payoutId: string): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'SENT' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * The provider is certain the transfer did not happen (definitive failure).
   * Marks the payout FAILED, releases the hold (held → available), and acks
   * the message — atomically.
   */
  async recordFailed(payoutId: string, errorMessage: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; account_id: string; amount_minor: bigint | string }>>`
        UPDATE "payouts"
        SET status = 'FAILED', error_message = ${errorMessage}
        WHERE id = ${payoutId} AND status = 'PROCESSING'
        RETURNING id, account_id, amount_minor
      `;
      if (rows.length === 0) {
        throw new Error(`cannot record failed for payout ${payoutId}: it is not in PROCESSING state`);
      }
      const { account_id: accountId, amount_minor: rawAmount } = rows[0];
      const amount = toBigInt(rawAmount);

      await tx.ledgerEntry.createMany({
        data: [
          { groupId: `${payoutId}:failed`, payoutId, account: 'USER_HELD', direction: 'DEBIT', amountMinor: amount },
          { groupId: `${payoutId}:failed`, payoutId, account: 'USER_AVAILABLE', direction: 'CREDIT', amountMinor: amount },
        ],
      });

      await tx.account.update({
        where: { id: accountId },
        data: { heldBalanceMinor: { decrement: amount }, version: { increment: 1 } },
      });

      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'DONE', completedAt: new Date() },
      });
    });
  }

  /**
   * The outcome is unknown (redelivery while in flight, or retry exhaustion).
   * Marks the payout NEEDS_REVIEW and dead-letters the message. The hold is
   * deliberately retained: releasing it could double-pay if the transfer
   * actually landed.
   */
  async recordNeedsReview(payoutId: string, errorMessage: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "payouts"
        SET status = 'NEEDS_REVIEW', error_message = ${errorMessage}
        WHERE id = ${payoutId} AND status = 'PROCESSING'
        RETURNING id
      `;
      if (rows.length === 0) {
        throw new Error(`cannot record needs_review for payout ${payoutId}: it is not in PROCESSING state`);
      }
      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'DEAD', completedAt: new Date() },
      });
    });
  }

  /** Requeue the message for a later attempt and reset the payout to CREATED. */
  async requeueForRetry(
    messageId: string,
    payoutId: string,
    attempts: number,
    nextAvailableAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'PENDING', attempts, availableAt: nextAvailableAt, claimedAt: null },
      }),
      this.prisma.payout.updateMany({
        where: { id: payoutId, status: 'PROCESSING' },
        data: { status: 'CREATED' },
      }),
    ]);
  }

  async completeMessage(messageId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'DONE', completedAt: new Date() },
    });
  }

  async deadMessage(messageId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'DEAD', completedAt: new Date() },
    });
  }

  /**
   * Claim a batch of due messages atomically. Also re-claims messages stuck in
   * PROCESSING past the lease (crashed worker) — this is what makes delivery
   * at-least-once. `FOR UPDATE SKIP LOCKED` keeps concurrent workers disjoint.
   */
  async claimMessages(batchSize: number, leaseMs: number): Promise<ClaimedMessage[]> {
    const lease = `${leaseMs} milliseconds`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; payload: unknown; attempts: number }>>`
      WITH claim AS (
        SELECT id
        FROM outbox_messages
        WHERE (status = 'PENDING' AND available_at <= now())
           OR (status = 'PROCESSING' AND claimed_at IS NOT NULL AND claimed_at <= now() - (${lease})::interval)
        ORDER BY created_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_messages m
      SET status = 'PROCESSING', claimed_at = now()
      FROM claim
      WHERE m.id = claim.id
      RETURNING m.id, m.payload, m.attempts
    `;
    return rows;
  }

  /**
   * Claim one specific message now (PENDING, or PROCESSING — i.e. a
   * redelivery). Returns null if the message is already DONE or DEAD.
   */
  async claimMessageById(messageId: string): Promise<ClaimedMessage | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; payload: unknown; attempts: number }>>`
      UPDATE outbox_messages
      SET status = 'PROCESSING', claimed_at = now()
      WHERE id = ${messageId} AND status IN ('PENDING', 'PROCESSING')
      RETURNING id, payload, attempts
    `;
    return rows.length > 0 ? rows[0] : null;
  }
}

function toBigInt(value: bigint | string | number): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
