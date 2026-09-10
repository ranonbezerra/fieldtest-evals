import { Injectable } from '@nestjs/common';
import { MessageStatus, Payout, PayoutStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type CreatePayoutInput = {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
};

export type PayoutRow = {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  lastError: string | null;
  createdAt: Date;
};

export type MessageRow = {
  id: bigint;
  payoutId: string;
  attempts: number;
};

export type CreatePayoutResult =
  | { kind: 'created'; payout: PayoutRow }
  | { kind: 'duplicate' }
  | { kind: 'account_not_found' }
  | { kind: 'insufficient_funds'; available: bigint };

/** System (counterpart) accounts of the double-entry ledger. */
export const SYSTEM_IN_FLIGHT = 'system:in_flight';
export const SYSTEM_OUTFLOW = 'system:outflow';

const LEG_RESERVE = 'payout_reserved';
const LEG_SETTLE = 'payout_settled';
const LEG_RELEASE = 'payout_released';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPayout(id: string): Promise<PayoutRow | null> {
    return this.prisma.payout.findUnique({ where: { id } }).then(toRow);
  }

  findPayoutByIdempotencyKey(key: string): Promise<PayoutRow | null> {
    return this.prisma.payout.findUnique({ where: { idempotencyKey: key } }).then(toRow);
  }

  findOpenMessages(limit: number): Promise<MessageRow[]> {
    return this.prisma.outboxMessage.findMany({
      where: { status: MessageStatus.OPEN },
      orderBy: { id: 'asc' },
      take: limit,
    });
  }

  /**
   * Creates the payout, its outbox message and the reserve ledger legs in ONE
   * transaction, reserving funds with a single conditional update so that the
   * check and the reservation are one atomic act the database serialises.
   *
   * The payout row is inserted before the reservation so that a racing
   * duplicate `idempotencyKey` loses on the unique constraint, rolls its whole
   * transaction back (reservation included) and can return the original
   * payout instead of reserving twice.
   */
  async createPayoutWithReservation(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.account.findUnique({ where: { id: input.accountId } });
        if (!account) {
          return { kind: 'account_not_found' as const };
        }

        const payout = await tx.payout.create({
          data: {
            accountId: input.accountId,
            amount: input.amount,
            destinationAddress: input.destinationAddress,
            idempotencyKey: input.idempotencyKey,
            status: PayoutStatus.CREATED,
          },
        });

        // The reservation only applies when the funds are there; the affected
        // row count is how the caller observes whether it won.
        const affected = await tx.$executeRaw`
          UPDATE accounts
          SET held = held + ${input.amount.toString()}::bigint
          WHERE id = ${input.accountId}
            AND settled - held >= ${input.amount.toString()}::bigint
        `;
        if (affected === 0) {
          return {
            kind: 'insufficient_funds' as const,
            available: account.settled - account.held,
          };
        }

        await tx.outboxMessage.create({
          data: { payoutId: payout.id, status: MessageStatus.OPEN },
        });

        await this.writeLedger(tx, payout.id, [
          { accountId: input.accountId, delta: -input.amount, code: LEG_RESERVE },
          { accountId: SYSTEM_IN_FLIGHT, delta: input.amount, code: LEG_RESERVE },
        ]);

        return { kind: 'created' as const, payout: toRow(payout)! };
      });
    } catch (error) {
      // The only unique constraint at risk in this transaction is
      // payouts.idempotency_key, so a unique violation means a racing
      // duplicate; the transaction rolled back, so nothing was reserved.
      const code = prismaErrorCode(error);
      if (code === 'P2002') {
        return { kind: 'duplicate' };
      }
      if (code === 'P2003') {
        return { kind: 'account_not_found' };
      }
      throw error;
    }
  }

  /**
   * Guarded claim: only one concurrent delivery can move a payout from
   * CREATED to PROCESSING. Returns false when the claim was lost.
   */
  async claimProcessing(id: string): Promise<boolean> {
    const { count } = await this.prisma.payout.updateMany({
      where: { id, status: PayoutStatus.CREATED },
      data: { status: PayoutStatus.PROCESSING },
    });
    return count === 1;
  }

  /** Records the txHash; from this point the payout is only ever confirmed. */
  async markSent(id: string, txHash: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.SENT, txHash },
    });
  }

  /** Records a non-final provider failure; the message stays OPEN. */
  async recordFailure(messageId: bigint, payoutId: string, attempts: number, lastError: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.outboxMessage.update({
        where: { id: messageId },
        data: { attempts, lastError },
      }),
      this.prisma.payout.update({
        where: { id: payoutId },
        data: { lastError },
      }),
    ]);
  }

  /**
   * Settlement, only on confirmed payment: SENT -> COMPLETED plus the account
   * movement and the settle ledger legs, atomically. Returns false when the
   * payout was not in SENT (a concurrent run already settled it).
   */
  async settlePayout(id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payout.updateMany({
        where: { id, status: PayoutStatus.SENT },
        data: { status: PayoutStatus.COMPLETED, completedAt: new Date() },
      });
      if (count === 0) {
        return false;
      }

      const payout = await tx.payout.findUniqueOrThrow({ where: { id } });
      const updated = await tx.$executeRaw`
        UPDATE accounts
        SET settled = settled - ${payout.amount.toString()}::bigint,
            held = held - ${payout.amount.toString()}::bigint
        WHERE id = ${payout.accountId}
          AND held >= ${payout.amount.toString()}::bigint
      `;
      if (updated === 0) {
        // Would break the books: no hold left to settle. Roll back entirely.
        throw new Error(`settlement refused for payout ${id}: held balance missing`);
      }

      await this.writeLedger(tx, payout.id, [
        { accountId: SYSTEM_IN_FLIGHT, delta: -payout.amount, code: LEG_SETTLE },
        { accountId: SYSTEM_OUTFLOW, delta: payout.amount, code: LEG_SETTLE },
      ]);
      return true;
    });
  }

  /**
   * Definitive failure: the provider confirmed the funds did NOT move. This
   * is the only path that releases a hold — SENT -> FAILED plus the release
   * ledger legs, atomically, and the message is marked processed.
   */
  async failPayoutDefinitively(id: string, messageId: bigint, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payout.updateMany({
        where: { id, status: PayoutStatus.SENT },
        data: { status: PayoutStatus.FAILED, completedAt: new Date(), lastError: reason },
      });
      if (count === 0) {
        return; // resolved by a concurrent run
      }

      const payout = await tx.payout.findUniqueOrThrow({ where: { id } });
      const updated = await tx.$executeRaw`
        UPDATE accounts
        SET held = held - ${payout.amount.toString()}::bigint
        WHERE id = ${payout.accountId}
          AND held >= ${payout.amount.toString()}::bigint
      `;
      if (updated === 0) {
        throw new Error(`release refused for payout ${id}: held balance missing`);
      }

      await this.writeLedger(tx, payout.id, [
        { accountId: payout.accountId, delta: payout.amount, code: LEG_RELEASE },
        { accountId: SYSTEM_IN_FLIGHT, delta: -payout.amount, code: LEG_RELEASE },
      ]);

      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: MessageStatus.PROCESSED, processedAt: new Date(), lastError: reason },
      });
    });
  }

  /**
   * Park: unknown outcome after bounded retries. Terminal for the worker,
   * visible to a human. The reservation is intentionally left in place.
   */
  async parkPayout(id: string, messageId: bigint, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payout.updateMany({
        where: {
          id,
          status: { in: [PayoutStatus.CREATED, PayoutStatus.PROCESSING, PayoutStatus.SENT] },
        },
        data: { status: PayoutStatus.NEEDS_REVIEW, completedAt: new Date(), lastError: reason },
      });
      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: MessageStatus.PROCESSED, processedAt: new Date(), lastError: reason },
      });
    });
  }

  async markMessageProcessed(id: bigint): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: { status: MessageStatus.PROCESSED, processedAt: new Date() },
    });
  }

  private writeLedger(
    tx: Prisma.TransactionClient,
    payoutId: string,
    legs: Array<{ accountId: string; delta: bigint; code: string }>,
  ): Promise<Prisma.BatchPayload> {
    return tx.ledgerEntry.createMany({
      data: legs.map((leg) => ({
        accountId: leg.accountId,
        delta: leg.delta,
        payoutId,
        code: leg.code,
      })),
    });
  }
}

function toRow(payout: Payout | null): PayoutRow | null {
  if (!payout) {
    return null;
  }
  return {
    id: payout.id,
    accountId: payout.accountId,
    amount: payout.amount,
    destinationAddress: payout.destinationAddress,
    idempotencyKey: payout.idempotencyKey,
    status: payout.status,
    txHash: payout.txHash,
    lastError: payout.lastError,
    createdAt: payout.createdAt,
  };
}

function prismaErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}
