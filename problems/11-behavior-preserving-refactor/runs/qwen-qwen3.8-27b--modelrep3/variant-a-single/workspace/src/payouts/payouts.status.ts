// Provider status -> internal status, for payout reconciliation.
// Same provider, two extra codes this side of the integration can receive.
//
// Delegates to the shared PaymentStatusMapper. Unknown codes come back as
// the 'unknown' sentinel — reconciliation must not stop on a code we have
// not seen yet (see NOTES.md — the consumers' unknown-code behaviors are
// intentionally not unified).

import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

// With onUnknown: 'unknown' the mapper returns a base status or the
// 'unknown' sentinel — exactly PayoutStatus (hence the cast).
const mapper = new PaymentStatusMapper({ onUnknown: 'unknown' });

export function mapProviderStatus(code: string): PayoutStatus {
  return mapper.map(code) as PayoutStatus;
}
