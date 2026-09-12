import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PayoutService } from './payout.service.js';

export interface PayoutWorkerOptions {
  /** start the polling interval when the module initializes (tests disable it) */
  autostart: boolean;
  /** poll every N milliseconds */
  intervalMs: number;
  /** maximum messages handled per poll */
  batchLimit: number;
  /** maximum transfer attempts before the payout is escalated to needs_review */
  maxAttempts: number;
  /** exponential backoff base, in milliseconds */
  backoffBaseMs: number;
  /** exponential backoff cap, in milliseconds */
  backoffMaxMs: number;
  /** a PROCESSING message older than this is assumed crashed and re-queued */
  staleProcessingMs: number;
}

export const PAYOUT_WORKER_OPTIONS = 'PAYOUT_WORKER_OPTIONS';

export function payoutWorkerOptionsFromEnv(): PayoutWorkerOptions {
  return {
    autostart: process.env.PAYOUT_WORKER_AUTOSTART !== 'false',
    intervalMs: Number(process.env.PAYOUT_WORKER_INTERVAL_MS ?? 5_000),
    batchLimit: Number(process.env.PAYOUT_WORKER_BATCH_LIMIT ?? 20),
    maxAttempts: Number(process.env.PAYOUT_MAX_ATTEMPTS ?? 3),
    backoffBaseMs: Number(process.env.PAYOUT_RETRY_BACKOFF_BASE_MS ?? 2_000),
    backoffMaxMs: Number(process.env.PAYOUT_RETRY_BACKOFF_MAX_MS ?? 30_000),
    staleProcessingMs: Number(process.env.PAYOUT_STALE_PROCESSING_MS ?? 60_000),
  };
}

/**
 * Polling worker: every `intervalMs` it reclaims crashed work and processes
 * every due outbox message. Delivery is at-least-once; the service applies
 * guarded transitions so redelivery is harmless.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly payouts: PayoutService,
    @Inject(PAYOUT_WORKER_OPTIONS) private readonly options: PayoutWorkerOptions,
  ) {}

  onModuleInit(): void {
    if (!this.options.autostart) return;
    this.timer = setInterval(() => {
      this.processMessages().catch((error: unknown) => {
        this.logger.error(`processMessages failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.options.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One poll: reclaim stale work, then process every due message. */
  async processMessages(): Promise<number> {
    const staleCutoff = new Date(Date.now() - this.options.staleProcessingMs);
    await this.payouts.recoverStaleMessages(staleCutoff);

    const due = await this.payouts.takeDueMessages(this.options.batchLimit);
    let handled = 0;
    for (const message of due) {
      const claimed = await this.payouts.claimMessage(message.id);
      if (!claimed) continue; // another worker beat us to it
      try {
        await this.payouts.processMessage(message.id, message.attempts + 1, {
          maxAttempts: this.options.maxAttempts,
          backoffBaseMs: this.options.backoffBaseMs,
          backoffMaxMs: this.options.backoffMaxMs,
        });
      } catch (error) {
        // The message stays PROCESSING; stale recovery will re-queue it and
        // the payout is in a safe state (no partial transition is committed).
        this.logger.error(
          `failed to process message ${message.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      handled += 1;
    }
    return handled;
  }
}
