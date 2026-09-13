import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { POLL_INTERVAL_MS } from './payout.types';

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private intervalId?: NodeJS.Timeout;

  constructor(private readonly payoutService: PayoutService) {}

  onModuleInit(): void {
    this.intervalId = setInterval(() => {
      this.payoutService.processMessages().catch((err: any) => {
        // eslint-disable-next-line no-console
        console.error('Worker error:', err);
      });
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}
