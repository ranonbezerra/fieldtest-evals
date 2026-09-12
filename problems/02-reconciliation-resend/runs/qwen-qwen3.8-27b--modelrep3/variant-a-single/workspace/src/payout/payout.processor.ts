import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PayoutService, startOfDayUtc } from './payout.service.js';

/** The job cadence required by the spec: safe every 15 minutes, windows may overlap. */
const CYCLE_INTERVAL_MS = 15 * 60 * 1000;
/** Statement lookback, so recent sends whose day is not today are still covered. */
const LOOKBACK_DAYS = 2;

@Injectable()
export class PayoutProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PayoutProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly service: PayoutService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.runCycle();
    }, CYCLE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** One job cycle: send what is eligible, then reconcile the recent window. */
  async runCycle(): Promise<void> {
    if (this.busy) return; // never overlap our own cycles
    this.busy = true;
    try {
      const now = new Date();
      const from = new Date(startOfDayUtc(now).getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      await this.service.executePayments();
      const summary = await this.service.reconcile({ from, to: now });
      this.logger.log(
        `cycle done: settled=${summary.settled} provenAbsent=${summary.provenAbsent} parked=${summary.parked}`,
      );
    } catch (err) {
      this.logger.error(`payout cycle failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
