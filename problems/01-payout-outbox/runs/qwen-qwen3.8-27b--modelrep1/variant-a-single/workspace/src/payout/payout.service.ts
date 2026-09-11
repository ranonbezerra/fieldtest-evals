import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Payout, PayoutStatus } from '@prisma/client';
import { readPositiveInt } from '../common/env.js';
import { PAYOUT_PROVIDER, type PayoutProvider } from './blockchain-provider.js';
import { PayoutRepository, type CreatePayoutInput } from './payout.repository.js';

export interface PayoutDto {
  id: string;
  status: 'created' | 'processing' | 'sent' | 'completed' | 'failed' | 'needs_review';
  amountMinor: number;
  destinationAddress: string;
  idempotencyKey: string;
  txHash: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
}

const STATUS_TO_API: Record<PayoutStatus, PayoutDto['status']> = {
  CREATED: 'created',
  PROCESSING: 'processing',
  SENT: 'sent',
  COMPLETED: 'completed',
  FAILED: 'failed',
  NEEDS_REVIEW: 'needs_review',
};

export function toPayoutDto(payout: Payout): PayoutDto {
  return {
    id: payout.id,
    status: STATUS_TO_API[payout.status],
    amountMinor: Number(payout.amountMinor),
    destinationAddress: payout.destinationAddress,
    idempotencyKey: payout.idempotencyKey,
    txHash: payout.txHash,
    errorMessage: payout.errorMessage,
    createdAt: payout.createdAt.toISOString(),
    sentAt: payout.sentAt ? payout.sentAt.toISOString() : null,
    completedAt: payout.completedAt ? payout.completedAt.toISOString() : null,
  };
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private readonly maxAttempts: number;
  private readonly retryBackoffBaseMs: number;

  constructor(
    private readonly repository: PayoutRepository,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {
    this.maxAttempts = readPositiveInt(process.env.PAYOUT_MAX_ATTEMPTS, 3);
    this.retryBackoffBaseMs = readPositiveInt(process.env.PAYOUT_RETRY_BACKOFF_MS, 1000);
  }

  async createPayout(input: CreatePayoutInput): Promise<{ payout: PayoutDto; replayed: boolean }> {
    const { payout, replayed } = await this.repository.createPayout(input);
    return { payout: toPayoutDto(payout), replayed };
  }

  /**
   * Handle one outbox delivery. Safe under at-least-once delivery: the provider
   * is called at most once per payout, and a redelivery whose prior outcome is
   * unknown escalates to needs_review instead of risking a double transfer.
   */
  async processPayoutMessage(messageId: string, payload: unknown, attemptsSoFar: number): Promise<void> {
    const payoutId = extractPayoutId(payload);
    if (payoutId === null) {
      this.logger.warn(`message ${messageId}: payload has no payoutId; dropping`);
      await this.repository.deadMessage(messageId);
      return;
    }

    const payout = await this.repository.findPayoutById(payoutId);
    if (payout === null) {
      this.logger.warn(`message ${messageId}: payout ${payoutId} no longer exists; dropping`);
      await this.repository.deadMessage(messageId);
      return;
    }

    if (payout.status !== 'CREATED' && payout.status !== 'PROCESSING') {
      // The payout already advanced or terminated (redelivery after the
      // outcome was recorded). Nothing left to do.
      await this.repository.completeMessage(messageId);
      return;
    }
    if (payout.status === 'PROCESSING') {
      // A prior attempt is in flight, or its worker died mid-attempt: the
      // outcome is unknown. Calling the provider again could pay out twice,
      // so escalate for manual reconciliation. The hold stays in place.
      await this.repository.recordNeedsReview(
        payout.id,
        'redelivered while a prior attempt was in flight; outcome unknown, manual review required',
        messageId,
      );
      return;
    }

    const started = await this.repository.beginProcessing(payout.id);
    if (!started) {
      // A concurrent delivery advanced the payout first.
      await this.repository.completeMessage(messageId);
      return;
    }

    let txHash: string;
    try {
      const result = await this.provider.transfer({ to: payout.destinationAddress, amount: payout.amountMinor });
      txHash = result.txHash;
    } catch (err) {
      const reason = toErrorMessage(err);
      if (isDefinitiveFailure(err)) {
        // The provider is certain the transfer did not happen: release the hold.
        await this.repository.recordFailed(payout.id, reason, messageId);
        return;
      }
      const attempts = attemptsSoFar + 1;
      if (attempts >= this.maxAttempts) {
        // Bounded retries exhausted without a definitive outcome. Stop and
        // flag: the funds stay held (see DESIGN.md) — a human reconciles with
        // the provider before the payout is completed or the hold released.
        await this.repository.recordNeedsReview(
          payout.id,
          `retries exhausted without a definitive outcome: ${reason}`,
          messageId,
        );
        return;
      }
      await this.repository.requeueForRetry(messageId, payout.id, attempts, this.nextRetryAt(attempts));
      return;
    }

    try {
      await this.repository.recordSent(payout.id, txHash, messageId);
      await this.repository.markCompleted(payout.id);
    } catch (err) {
      // The conditional transition lost a race (e.g. a lease re-claim
      // escalated the payout). The provider result is logged for
      // reconciliation; the transfer is never re-attempted here.
      this.logger.error(
        `provider confirmed txHash=${txHash} for payout ${payout.id} but the state transition failed: ${toErrorMessage(err)}`,
      );
    }
  }

  private nextRetryAt(attempts: number): Date {
    const backoffMs = this.retryBackoffBaseMs * 2 ** (attempts - 1);
    return new Date(Date.now() + backoffMs);
  }
}

function extractPayoutId(payload: unknown): string | null {
  let candidate: unknown = payload;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (typeof candidate !== 'object' || candidate === null) return null;
  const payoutId = (candidate as Record<string, unknown>).payoutId;
  return typeof payoutId === 'string' && payoutId.length > 0 ? payoutId : null;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ASSUMPTION: the provider SDK's error shape is unspecified. Errors carrying a
// truthy `permanent` or `definitive` flag are treated as definitive (the
// transfer is known not to have happened); every other error is treated as
// unknown and retried within the bound.
function isDefinitiveFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { permanent?: unknown; definitive?: unknown };
  return Boolean(e.permanent) || Boolean(e.definitive);
}
