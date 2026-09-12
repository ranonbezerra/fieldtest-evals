// Provider status -> internal status, for payout reconciliation.
// Thin delegate to the shared PaymentStatusMapper, which knows the union of
// provider codes (including the two payout-only codes this side of the
// integration can receive).
import { PaymentStatusMapper } from '../shared/payment-status.mapper.js';

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
  if (status === null) {
    // Payouts policy: reconciliation must not stop on a code we have not
    // seen yet; it is recorded as unresolved upstream.
    return 'unknown';
  }
  if (status === 'FAILED') {
    // Unreachable: this mapper is constructed without legacyReportCasing.
    // Bucketing as 'unknown' keeps reconciliation running if that ever changes.
    return 'unknown';
  }
  return status;
}
