import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutProvider, PayoutProviderToken, TransferOutcome } from './payout.provider.js';
import {
  Delivery,
  PayoutRecord,
  PayoutRepository,
} from './payout.repository.js';
import { PayoutValidationError } from './payout.errors.js';

export const MAX_PROVIDER_ATTEMPTS = 4;

export interface PayoutView {
  id: string;
  accountId: string;
  amount: string;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  txHash: string | null;
}

/**
 * Money is BigInt (minor units) end to end. It crosses the HTTP boundary as a
 * string of decimal digits, never as a JS number.
 */
export function parseAmount(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    throw new PayoutValidationError({
      amount: 'amount must be a non-negative integer string in minor units',
    });
  }
  return BigInt(raw.trim());
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repository: PayoutRepository,
    @PayoutProviderToken private readonly provider: PayoutProvider,
  ) {}

  async createPayout(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRecord> {
    // Fast path for client retries: the unique (accountId, idempotencyKey)
    // constraint is the backstop for the racing case below.
    const existing = await this.repository.findPayoutByKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing) {
      return existing;
    }

    try {
      const accountId = await this.repository.createPayoutWithOutbox(input);
      const record = await this.repository.findPayoutById(accountId);
      if (!record) {
        throw new Error(`Payout ${accountId} vanished after creation`);
      }
      return record;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // A concurrent request with the same key won the race; return its
        // payout and reserve nothing further.
        const winner = await this.repository.findPayoutByKey(
          input.accountId,
          input.idempotencyKey,
        );
        if (winner) {
          return winner;
        }
      }
      throw e;
    }
  }

  /**
   * Processes one outbox delivery. Safe against at-least-once redelivery:
   * guarded transitions plus the processed-message mark make any duplicate a
   * no-op, and the ledger's unique pair makes double settlement impossible.
   */
  async processDelivery(delivery: Delivery): Promise<void> {
    const payout = await this.repository.findPayoutById(delivery.payoutId);
    if (!payout) {
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (payout.status === 'SENT' || payout.status === 'COMPLETED') {
      // Already sent by an earlier delivery of the same message. No transfer,
      // no ledger movement.
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (payout.status !== 'CREATED' && payout.status !== 'PROCESSING') {
      // Terminal (FAILED / NEEDS_REVIEW): a human owns it from here.
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    await this.repository.markProcessing(payout.id);

    const result = await this.safeTransfer(
      payout.destinationAddress,
      payout.amount,
    );

    if (result.txHash) {
      // The outcome is now knowable. Settlement waits for confirmation.
      await this.repository.recordSent(payout.id, result.txHash);
      await this.repository.settle(
        payout.id,
        payout.accountId,
        payout.amount,
        delivery.outboxId,
      );
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (result.definitive) {
      // The provider said definitively the transfer did not happen: the
      // reservation is released and the funds return to available.
      await this.repository.recordDefinitiveFailure({
        payoutId: payout.id,
        accountId: payout.accountId,
        amount: payout.amount,
        error: result.message ?? 'provider reported a definitive failure',
        outboxId: delivery.outboxId,
      });
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    // No definitive outcome: count the attempt and either reschedule or park.
    const attempts = payout.attempts + 1;
    const exhausted = attempts >= MAX_PROVIDER_ATTEMPTS;
    await this.repository.recordFailure({
      payoutId: payout.id,
      error: result.message ?? 'provider returned no outcome',
      exhausted,
      outboxId: delivery.outboxId,
      retryAt: new Date(delivery.deliveredAt.getTime() + 1000 * 2 ** attempts),
    });
    await this.repository.markProcessed(delivery.outboxId);
  }

  private async safeTransfer(
    to: string,
    amount: bigint,
  ): Promise<TransferOutcome> {
    try {
      const outcome = await this.provider.transfer({ to, amount });
      if (outcome.txHash) {
        return outcome;
      }
      return {
        definitive: false,
        message: outcome.message ?? 'no tx hash returned',
      };
    } catch (e) {
      const err = e as {
        txHash?: string;
        definitive?: boolean;
        message?: string;
      };
      if (typeof err.txHash === 'string') {
        // A tx hash even on an error path means the outcome is knowable.
        return { txHash: err.txHash, message: err.message };
      }
      if (err.definitive === true) {
        return { definitive: true, message: err.message ?? String(e) };
      }
      // Timeout or SDK failure with no outcome: the transfer may still land.
      return { definitive: false, message: err.message ?? String(e) };
    }
  }

  toView(payout: PayoutRecord): PayoutView {
    return {
      id: payout.id,
      accountId: payout.accountId,
      amount: payout.amount.toString(),
      destinationAddress: payout.destinationAddress,
      idempotencyKey: payout.idempotencyKey,
      status: payout.status,
      txHash: payout.txHash,
    };
  }
}
