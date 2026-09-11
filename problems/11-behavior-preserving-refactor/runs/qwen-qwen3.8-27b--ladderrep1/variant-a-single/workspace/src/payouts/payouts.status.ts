// Provider status -> internal status, for payout reconciliation.
//
// The mapping table itself lives in src/shared/payment-status-mapper.ts,
// which covers the union of every provider code, including the two codes
// only this side of the integration receives (PAYOUT_SETTLED,
// PAYOUT_REVERSED). This module keeps only the payouts-specific contract:
// reconciliation must not stop on a code nobody has seen yet, so an
// unknown provider code maps to 'unknown'. The divergence from orders and
// reporting is deliberate; see NOTES.md.

import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

const mapper = new PaymentStatusMapper();

export function mapProviderStatus(code: string): PayoutStatus {
  const status = mapper.map(code);
  if (status === null || status === 'FAILED') {
    // 'FAILED' is unreachable through this mapper: it is only produced
    // with { legacyReportCasing: true }, which the reporting script is the
    // only call site that passes.
    return 'unknown';
  }
  return status;
}
