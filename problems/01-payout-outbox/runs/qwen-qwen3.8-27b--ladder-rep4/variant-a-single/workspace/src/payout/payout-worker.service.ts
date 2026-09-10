import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Delivery, PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

/**
 * Polling worker: claims outbox messages and drives provider transfers
 * asynchronously. processMessages() runs every N seconds (environment
 * configured) and each delivery is handled individually, so one poisoned
 * message cannot block the queue.
 */
@Injectable()
export class PayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly repository: PayoutRepository,
  ) {}

  onModuleInit(): void {
    const intervalMs = process.env.WORKER_POLL_INTERVAL_MS
      ? Number(process.env.WORKER_POLL_INTERVAL_MS)
      : 5000;
    this.timer = setInterval(() => {
      void this.processMessages().catch((e) =>
        this.logger.error(`processMessages failed: ${(e as Error).message}`),
      );
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<number> {
    const delivery = await this.repository.claimNext();
    if (!delivery) {
      return 0;
    }
    try {
      await this.service.processDelivery(delivery);
    } catch (e) {
      // Leave the claimed row in PROCESSING; the stale-window re-claim in
      // claimNext() picks it up on a later tick.
      this.logger.error(
        `delivery ${delivery.outboxId} failed: ${(e as Error).message}`,
      );
    }
    return 1;
  }
}
