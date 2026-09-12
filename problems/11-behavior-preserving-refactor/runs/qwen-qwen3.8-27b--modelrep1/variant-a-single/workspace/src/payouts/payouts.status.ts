// Provider status -> internal status, for payout reconciliation.
// Same provider, two extra codes this side of the integration can receive
// (PAYOUT_SETTLED, PAYOUT_REVERSED) — both handled by the shared mapper.
//
// This module keeps the payouts-facing contract: an unknown provider code
// comes back as 'unknown' so reconciliation must not stop.
// See NOTES.md for why the call sites are not unified on that.
import { PaymentStatusMapper } from '../shared/payment-status.mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

const mapper = new PaymentStatusMapper({ onUnknown: 'returnUnknown' });

export function mapProviderStatus(code: string): PayoutStatus {
  const status = mapper.map(code);
  if (status === null || status === 'FAILED') {
    // Unreachable: payouts never sets legacyReportCasing, and
    // onUnknown: 'returnUnknown' makes map() return 'unknown' instead of
    // null. The branch exists only to narrow the type to PayoutStatus.
    throw new Error(`unreachable: unexpected mapper result for ${code}`);
  }
  return status;
}
