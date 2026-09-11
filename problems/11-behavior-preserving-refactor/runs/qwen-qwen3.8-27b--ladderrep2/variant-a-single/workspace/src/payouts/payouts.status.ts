// Provider status -> internal status, for payout reconciliation.
// Delegates to the shared PaymentStatusMapper (src/shared/payment-status-mapper.ts),
// which knows the two payout-specific provider codes (PAYOUT_SETTLED,
// PAYOUT_REVERSED) alongside the base set.

import { PaymentStatusMapper, type PaymentStatus } from '../shared/payment-status-mapper.js';

export type PayoutStatus = PaymentStatus | 'unknown';

const mapper = new PaymentStatusMapper();

export function mapProviderStatus(code: string): PayoutStatus {
  // Reconciliation must not stop on a code we have not seen yet: unknown
  // codes come back as the 'unknown' sentinel and are booked as unresolved.
  // One of three deliberate unknown-code divergences — see NOTES.md.
  return mapper.map(code, { onUnknown: 'unknown' });
}
