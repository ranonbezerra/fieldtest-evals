// Provider status -> internal status, for payout reconciliation.
//
// The mapping table lives in the shared PaymentStatusMapper (src/shared/),
// which covers the union of provider codes, including the two this side of
// the integration receives extra: PAYOUT_SETTLED and PAYOUT_REVERSED.
import { PaymentStatusMapper, type PaymentStatus } from '../shared/payment-status.mapper.js';

export type PayoutStatus = PaymentStatus | 'unknown';

// onUnknownCode: 'unknown' preserves the pre-extraction payouts behaviour:
// reconciliation must not stop on a code we have not seen yet, so the
// record is bucketed as unresolved by PayoutsService.
const mapper = new PaymentStatusMapper({ onUnknownCode: 'unknown' });

export function mapProviderStatus(code: string): PayoutStatus {
  // This instance is configured with onUnknownCode: 'unknown', so it
  // returns a canonical status or 'unknown' -- never null or 'FAILED'.
  return mapper.map(code) as PayoutStatus;
}
