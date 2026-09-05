// ASSUMPTION: @nestjs/common is not resolvable in this workspace, so the @Injectable() decorator and any NestJS DI wiring are omitted.
// ASSUMPTION: ./payouts.repository does not exist in this workspace, so the repository dependency is omitted.
// ASSUMPTION: The fallback value for unknown provider codes in the payouts flow is 'refunded' per PLAN.md; the original fixture literal could not be confirmed.

import { PaymentStatusMapper } from '../shared/payment-status-mapper';

export class PayoutsService {
  private readonly mapper: PaymentStatusMapper;

  constructor() {
    this.mapper = new PaymentStatusMapper({
      unknownPolicy: 'fallback',
      fallbackValue: 'refunded',
    });
  }

  /**
   * Map a raw provider status code to the internal payout status.
   * Unknown codes fall back to 'refunded' (preserves legacy behaviour of
   * returning a concrete string rather than throwing or skipping).
   */
  mapStatus(providerCode: string): string {
    return this.mapper.map(providerCode) ?? 'refunded';
  }
}
