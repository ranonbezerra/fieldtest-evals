import { PaymentStatusMapper, InternalStatus } from '../shared/payment-status-mapper';

export class OrdersService {
  private readonly mapper = new PaymentStatusMapper({ unknownPolicy: 'throw' });

  /**
   * Map a raw provider status code to the internal status for display.
   * Throws TypeError on unknown codes (preserves original orders behaviour).
   */
  mapStatus(providerCode: string): InternalStatus {
    // ASSUMPTION: mapper.map() returns `string | undefined` (widened to accommodate
    // the legacyReportCasing quirk). With `unknownPolicy: 'throw'` and no
    // `legacyReportCasing`, the result is always a valid InternalStatus.
    return this.mapper.map(providerCode) as InternalStatus;
  }
}
