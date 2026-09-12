import { Injectable } from '@nestjs/common';

@Injectable()
export class PayoutConfigService {
  get outboxPollMs(): number {
    return this.positiveInt(process.env.PAYOUT_OUTBOX_POLL_MS, 5000);
  }

  get maxDeliveryAttempts(): number {
    return this.positiveInt(process.env.PAYOUT_OUTBOX_MAX_ATTEMPTS, 5);
  }

  get backoffSeconds(): number {
    return this.positiveInt(process.env.PAYOUT_OUTBOX_BACKOFF_SECONDS, 15);
  }

  get workerEnabled(): boolean {
    return process.env.PAYOUT_OUTBOX_WORKER_DISABLED !== '1';
  }

  private positiveInt(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
