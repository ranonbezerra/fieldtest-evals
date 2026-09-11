// Provider status -> internal status, for the order detail screen.
//
// The mapping table itself lives in src/shared/payment-status-mapper.ts;
// this module keeps only the orders-specific contract: the order screen
// has no fallback for a status it cannot display, so an unknown provider
// code fails loudly (throw). The divergence from payouts and reporting is
// deliberate; see NOTES.md.

import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

const mapper = new PaymentStatusMapper();

export function mapProviderStatus(code: string): OrderStatus {
  const status = mapper.map(code);
  if (status === null || status === 'FAILED') {
    // 'FAILED' is unreachable through this mapper: it is only produced
    // with { legacyReportCasing: true }, which the reporting script is the
    // only call site that passes.
    throw new Error(`unknown provider status: ${code}`);
  }
  return status;
}
