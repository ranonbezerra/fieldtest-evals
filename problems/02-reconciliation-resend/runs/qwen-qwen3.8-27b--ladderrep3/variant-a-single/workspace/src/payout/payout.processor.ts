import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PayoutService, ReconcileWindow } from './payout.service.js';

/** Reconcile cadence. */
export const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Trailing window per run. Wider than the interval, so consecutive runs
 * overlap; reconcile() is written to be safe across that overlap.
 */
export const RECONCILE_WINDOW_MS = 45 * 60 * 1000;

@Injectable()
export class PayoutProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutProcessor.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly payouts: Pick<PayoutService, 'reconcile'>) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.RECONCILE_INTERVAL_MS) || RECONCILE_INTERVAL_MS;
    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        this.logger.error(`reconcile tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One reconcile pass over the trailing overlapping window. */
  async tick(asOf: Date = new Date()): Promise<ReconcileWindow> {
    const window: ReconcileWindow = {
      from: new Date(asOf.getTime() - RECONCILE_WINDOW_MS),
      to: new Date(asOf.getTime()),
    };
    this.logger.log(`reconciling ${window.from.toISOString()} .. ${window.to.toISOString()}`);
    await this.payouts.reconcile(window);
    return window;
  }
}
