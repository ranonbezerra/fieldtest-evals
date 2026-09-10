import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { PAYOUT_PROVIDER } from './payout.provider.js';
import type { PayoutProvider } from './payout.provider.js';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Polling worker for the payout outbox. `processMessages()` runs on an
 * interval; delivery is at-least-once, and every state change below is a
 * guarded conditional update so a redelivered message can never pay twice.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(PayoutRepository) private readonly payouts: PayoutRepository,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return; // tests drive processMessages() directly
    }
    const intervalMs = envInt('WORKER_POLL_INTERVAL_MS', 5_000);
    this.timer = setInterval(() => {
      void this.processMessages().catch((error) => this.logger.error(`processMessages crashed: ${error}`));
    }, intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async processMessages(): Promise<void> {
    if (this.running) {
      return; // previous tick still in flight
    }
    this.running = true;
    try {
      const now = new Date();
      const limit = envInt('WORKER_BATCH_SIZE', 20);
      const leaseMs = envInt('WORKER_MESSAGE_LEASE_MS', 300_000);
      const claimed = await this.payouts.claimMessages(now, new Date(now.getTime() - leaseMs), limit);
      for (const messageId of claimed) {
        try {
          await this.processMessage(messageId, now);
        } catch (error) {
          // Leave the message claimed; the lease will expire and the payout's
          // guards decide what a redelivery may do (never re-send blindly).
          this.logger.error(`failed to process message ${messageId}: ${error}`);
        }
      }

      const sent = await this.payouts.findSentPayouts(limit);
      for (const payout of sent) {
        try {
          await this.payouts.settlePayout(payout.id);
        } catch (error) {
          this.logger.error(`failed to settle payout ${payout.id}: ${error}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async processMessage(messageId: string, now: Date): Promise<void> {
    const message = await this.payouts.findMessageWithPayout(messageId);
    if (!message) {
      return;
    }
    const payout = message.payout;

    // Redeliveries after the outcome is already known are no-ops.
    if (payout.status === 'completed' || payout.status === 'needs_review' || payout.status === 'sent') {
      await this.payouts.markMessageDone(messageId);
      return;
    }

    if (payout.status === 'created') {
      const started = await this.payouts.transitionPayout(payout.id, 'created', 'processing');
      if (!started) {
        await this.payouts.markMessageDone(messageId);
        return;
      }
    } else if (payout.status === 'processing' && payout.attemptState === 'in_flight') {
      // A previous attempt may have reached the provider and its outcome is
      // unknown. Calling transfer() again could pay twice, so park the payout
      // for a human instead. The reservation stays in place.
      await this.payouts.transitionPayout(payout.id, 'processing', 'needs_review', {
        errorMessage: 'worker re-delivered an in-flight attempt; outcome unknown, parked for review',
      });
      await this.payouts.markMessageDone(messageId);
      return;
    }

    const maxAttempts = envInt('PAYOUT_MAX_ATTEMPTS', 3);
    const backoffMs = envInt('PAYOUT_RETRY_BACKOFF_MS', 1_000);
    const attempts = payout.attempts + 1;

    // Count the attempt before calling the provider: a crash mid-call then
    // reads as in_flight on redelivery and parks instead of paying again.
    await this.payouts.recordAttempt(payout.id, { attempts, attemptState: 'in_flight' });

    let txHash: string;
    try {
      ({ txHash } = await this.provider.transfer(payout.destinationAddress, payout.amountMinorUnits));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (attempts >= maxAttempts) {
        // Retries exhausted without a confirmed outcome: park, keep the
        // reservation, never reverse. See DESIGN.md for why this direction is safe.
        await this.payouts.transitionPayout(payout.id, 'processing', 'needs_review', {
          errorMessage: `provider failed after ${attempts} attempts: ${reason}`,
        });
        await this.payouts.markMessageDone(messageId);
        return;
      }
      await this.payouts.recordAttempt(payout.id, { attemptState: 'failed', errorMessage: reason });
      await this.payouts.requeueMessage(messageId, new Date(now.getTime() + backoffMs * attempts));
      return;
    }

    // ASSUMPTION: the provider SDK exposes only transfer(), so a resolved
    // transfer (txHash in hand) is treated as the provider confirming the
    // transfer. A txHash is not settlement: it only makes the outcome
    // knowable. Record it (status `sent`) and let the settlement step move
    // balances exactly once, never on the send itself.
    const marked = await this.payouts.transitionPayout(payout.id, 'processing', 'sent', { txHash });
    if (!marked) {
      // Lost the race to a concurrent park; keep the txHash for the reviewer.
      await this.payouts.recordTxHash(payout.id, txHash);
    }
    await this.payouts.markMessageDone(messageId);
  }
}
