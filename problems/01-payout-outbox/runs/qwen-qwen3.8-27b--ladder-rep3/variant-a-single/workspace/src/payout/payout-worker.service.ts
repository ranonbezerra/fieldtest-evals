import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import type { OutboxMessage, Payout } from '@prisma/client';
import { PayoutRepository } from './payout.repository.js';
import { PayoutProvider, PAYOUT_PROVIDER } from './payout-provider.js';

export type ProcessOutcome = 'processed' | 'rescheduled' | 'skipped';

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

@Injectable()
export class PayoutWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repository: PayoutRepository,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = readIntEnv('WORKER_POLL_INTERVAL_MS', 5000);
    this.timer = setInterval(() => {
      // A failed poll must not kill the process; the next poll retries.
      this.processMessages().catch((error: unknown) => {
        this.logger.error(`poll failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One poll: pick due messages and process each. Delivery is at-least-once. */
  async processMessages(): Promise<number> {
    const now = new Date();
    const leaseCutoff = new Date(now.getTime() - readIntEnv('MESSAGE_LEASE_MS', 30_000));
    const due = await this.repository.findDueMessages(now, leaseCutoff, readIntEnv('WORKER_BATCH_SIZE', 10));
    let handled = 0;
    for (const message of due) {
      const outcome = await this.processMessage(message.id);
      if (outcome !== 'skipped') {
        handled += 1;
      }
    }
    return handled;
  }

  /**
   * Process one message. Safe to call for the same id any number of times:
   * the claim is a conditional update and every payout transition below is
   * guarded, so a duplicate delivery is a no-op.
   */
  async processMessage(messageId: string): Promise<ProcessOutcome> {
    const leaseCutoff = new Date(Date.now() - readIntEnv('MESSAGE_LEASE_MS', 30_000));
    const message = await this.repository.claimMessage(messageId, leaseCutoff);
    if (!message) {
      return 'skipped';
    }

    const payout = await this.repository.findPayoutById(message.payoutId);
    if (!payout) {
      // A message pointing at a missing payout is corrupt; park it for humans.
      this.logger.error(`outbox message ${message.id} references missing payout ${message.payoutId}; parking`);
      await this.repository.completeMessage(message.id, message.attempts);
      return 'processed';
    }

    switch (payout.status) {
      case PayoutStatus.COMPLETED:
      case PayoutStatus.NEEDS_REVIEW:
      case PayoutStatus.FAILED:
        // Terminal: nothing left to do.
        await this.repository.completeMessage(message.id, message.attempts);
        return 'processed';
      case PayoutStatus.SENT:
        // The txHash is on record: settle it without calling the provider
        // again for this payout.
        await this.settleOrPark(payout, message);
        await this.repository.completeMessage(message.id, message.attempts);
        return 'processed';
      case PayoutStatus.CREATED:
      case PayoutStatus.PROCESSING:
        return this.attemptTransfer(message, payout);
    }

    // Unreachable: every PayoutStatus is handled above.
    this.logger.error(`unexpected payout status ${payout.status} for message ${message.id}`);
    return 'skipped';
  }

  private async attemptTransfer(message: OutboxMessage, payout: Payout): Promise<ProcessOutcome> {
    await this.repository.markProcessing(payout.id);
    try {
      const { txHash } = await this.provider.transfer({
        to: payout.destinationAddress,
        amount: payout.amount,
      });
      const recorded = await this.repository.recordTxHash(payout.id, txHash);
      if (recorded.status === PayoutStatus.SENT) {
        await this.settleOrPark(payout, message);
      }
      await this.repository.completeMessage(message.id, message.attempts);
      this.logger.log(`payout ${payout.id} sent (txHash=${recorded.txHash})`);
      return 'processed';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const attempts = message.attempts + 1;
      await this.repository.recordAttempt(payout.id, attempts, reason);

      const maxAttempts = readIntEnv('MAX_PROVIDER_ATTEMPTS', 3);
      if (attempts >= maxAttempts) {
        // Exhausted without a definitive outcome: park for human review and
        // keep the reservation in place. Reverting is the unsafe direction —
        // the transfer may still land (see DESIGN.md).
        await this.repository.markNeedsReview(payout.id, attempts, reason);
        await this.repository.completeMessage(message.id, attempts);
        this.logger.warn(`payout ${payout.id} parked in NEEDS_REVIEW after ${attempts} attempts: ${reason}`);
        return 'processed';
      }

      const backoffMs = Math.min(60_000, 5_000 * attempts);
      await this.repository.rescheduleMessage(message.id, attempts, new Date(Date.now() + backoffMs));
      this.logger.warn(`payout ${payout.id} attempt ${attempts}/${maxAttempts} failed, next in ${backoffMs}ms: ${reason}`);
      return 'rescheduled';
    }
  }

  /**
   * Settlement is the only path that moves the settled balance. If it fails
   * (an invariant we expect to hold, e.g. the reservation missing), park the
   * payout for humans instead of retrying forever.
   */
  private async settleOrPark(payout: Payout, message: OutboxMessage): Promise<void> {
    try {
      const settled = await this.repository.settlePayout(payout.id, payout.accountId, payout.amount);
      this.logger.log(`payout ${payout.id} ${settled ? 'settled' : 'already settled (no-op)'}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.repository.markNeedsReview(payout.id, message.attempts, `settlement failed: ${reason}`);
      this.logger.error(`payout ${payout.id} parked: settlement failed: ${reason}`);
    }
  }
}
