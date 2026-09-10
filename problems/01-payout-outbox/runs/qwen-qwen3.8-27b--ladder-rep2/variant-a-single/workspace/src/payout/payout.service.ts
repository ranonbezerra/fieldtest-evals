import { Inject, Injectable } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import {
  PayoutRepository,
  type CreatePayoutInput,
  type MessageRow,
  type PayoutRow,
} from './payout.repository.js';
import { PAYOUT_PROVIDER, type PayoutProvider } from './payout-provider.js';

export type PayoutDto = {
  id: string;
  accountId: string;
  amount: string; // minor units, serialised as a string — never a float
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const MESSAGE_BATCH_SIZE = 25;

@Injectable()
export class PayoutService {
  private readonly maxAttempts: number;
  /** Payouts whose message a tick is currently processing (guards overlap). */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly repo: PayoutRepository,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {
    this.maxAttempts = Number(process.env.PAYOUT_MAX_PROVIDER_ATTEMPTS ?? DEFAULT_MAX_ATTEMPTS);
  }

  async createPayout(input: CreatePayoutInput): Promise<PayoutDto> {
    // Fast path: a retry with a known key returns the original payout.
    const existing = await this.repo.findPayoutByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return toDto(existing);
    }

    const result = await this.repo.createPayoutWithReservation(input);
    switch (result.kind) {
      case 'created':
        return toDto(result.payout);
      case 'duplicate': {
        // A concurrent request with the same key won; return its payout.
        const winner = await this.repo.findPayoutByIdempotencyKey(input.idempotencyKey);
        if (!winner) {
          throw new ApiError(
            500,
            'internal_error',
            'duplicate idempotency key but the original payout could not be loaded',
            {},
          );
        }
        return toDto(winner);
      }
      case 'account_not_found':
        throw new ApiError(404, 'resource_not_found', `account ${input.accountId} does not exist`, {
          accountId: input.accountId,
        });
      case 'insufficient_funds':
        throw new ApiError(422, 'insufficient_funds', 'available funds are insufficient for this payout', {
          accountId: input.accountId,
          requested: input.amount.toString(),
          available: result.available.toString(),
        });
    }
  }

  /** One worker tick: drain the outbox. Designed for a single scheduler. */
  async processMessages(): Promise<void> {
    const messages = await this.repo.findOpenMessages(MESSAGE_BATCH_SIZE);
    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  /**
   * Processes one outbox message. Safe under at-least-once redelivery: every
   * state change is a guarded conditional update, and a payout that has
   * produced a txHash is never re-sent — only confirmed.
   */
  private async processMessage(message: MessageRow): Promise<void> {
    if (this.inFlight.has(message.payoutId)) {
      return; // an overlapping tick already owns this payout
    }
    this.inFlight.add(message.payoutId);
    try {
      const payout = await this.repo.findPayout(message.payoutId);
      if (!payout) {
        await this.repo.markMessageProcessed(message.id);
        return;
      }

      if (isTerminal(payout.status)) {
        await this.repo.markMessageProcessed(message.id);
        return;
      }

      if (payout.status === PayoutStatus.CREATED) {
        if (!(await this.repo.claimProcessing(payout.id))) {
          return; // a concurrent delivery claimed it; it owns the message
        }
      }

      if (payout.txHash !== null) {
        await this.confirmSettlement(payout, message);
        return;
      }

      await this.attemptTransfer(payout, message);
    } finally {
      this.inFlight.delete(message.payoutId);
    }
  }

  private async attemptTransfer(payout: PayoutRow, message: MessageRow): Promise<void> {
    try {
      const { txHash } = await this.provider.transfer({
        to: payout.destinationAddress,
        amount: payout.amount,
      });
      await this.repo.markSent(payout.id, txHash);
      await this.confirmSettlement({ ...payout, status: PayoutStatus.SENT, txHash }, message);
    } catch (error) {
      // Unknown outcome: the chain may have accepted the transfer anyway.
      // Never release the hold here — bounded retry, then park.
      await this.exhaustOrRetry(message, payout, error, 'provider transfer');
    }
  }

  private async confirmSettlement(payout: PayoutRow, message: MessageRow): Promise<void> {
    const txHash = payout.txHash;
    if (!txHash) {
      throw new Error(`refusing to confirm settlement for payout ${payout.id}: no txHash recorded`);
    }
    try {
      const { settled } = await this.provider.confirmSettlement(txHash);
      if (settled) {
        // Idempotent: only one concurrent run can pass SENT -> COMPLETED.
        await this.repo.settlePayout(payout.id);
        await this.repo.markMessageProcessed(message.id);
      } else {
        // Definitive: the provider says the funds did not move. Only now is
        // a reversal safe.
        await this.repo.failPayoutDefinitively(
          payout.id,
          message.id,
          `provider reported tx ${txHash} did not settle`,
        );
      }
    } catch (error) {
      await this.exhaustOrRetry(message, payout, error, 'settlement confirmation');
    }
  }

  private async exhaustOrRetry(
    message: MessageRow,
    payout: PayoutRow,
    error: unknown,
    phase: string,
  ): Promise<void> {
    const attempts = message.attempts + 1;
    const detail = error instanceof Error ? error.message : String(error);
    if (attempts >= this.maxAttempts) {
      await this.repo.parkPayout(
        payout.id,
        message.id,
        `${phase} failed after ${attempts} attempts without a definitive outcome; last error: ${detail}`,
      );
    } else {
      await this.repo.recordFailure(message.id, payout.id, attempts, detail);
    }
  }
}

function isTerminal(status: PayoutStatus): boolean {
  return (
    status === PayoutStatus.COMPLETED ||
    status === PayoutStatus.FAILED ||
    status === PayoutStatus.NEEDS_REVIEW
  );
}

function toDto(payout: PayoutRow): PayoutDto {
  return {
    id: payout.id,
    accountId: payout.accountId,
    amount: payout.amount.toString(),
    destinationAddress: payout.destinationAddress,
    idempotencyKey: payout.idempotencyKey,
    status: payout.status,
    txHash: payout.txHash,
    createdAt: payout.createdAt,
  };
}
