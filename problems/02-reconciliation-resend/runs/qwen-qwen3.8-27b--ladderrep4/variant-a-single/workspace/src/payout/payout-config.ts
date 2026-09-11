import { Injectable } from '@nestjs/common';

// The bank publishes statements with up to ~30 minutes of lag; absence is only
// evidence past that.
const DEFAULT_PUBLISHING_LAG_MINUTES = 30;
const DEFAULT_MAX_SEND_ATTEMPTS = 5;

/**
 * Configuration from environment variables only:
 *   PAYOUT_PUBLISHING_LAG_MINUTES (default 30)
 *   PAYOUT_MAX_SEND_ATTEMPTS      (default 5)
 */
@Injectable()
export class PayoutConfig {
  get lagMs(): number {
    return readPositiveInt(process.env.PAYOUT_PUBLISHING_LAG_MINUTES, DEFAULT_PUBLISHING_LAG_MINUTES) * 60_000;
  }

  get maxAttempts(): number {
    return readPositiveInt(process.env.PAYOUT_MAX_SEND_ATTEMPTS, DEFAULT_MAX_SEND_ATTEMPTS);
  }
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
