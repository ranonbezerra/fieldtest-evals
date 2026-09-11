// Provider status -> internal status, for payout reconciliation.
//
// The mapping table now lives in the shared PaymentStatusMapper
// (src/shared/payment-status.mapper.ts), which covers the union of codes,
// including the two payout-only ones (PAYOUT_SETTLED, PAYOUT_REVERSED).
// Payouts' contract is unchanged and deliberately different from the other
// call sites: unknown codes map to the 'unknown' sentinel so a
// reconciliation run never stops — see NOTES.md.
import { paymentStatusMapper } from '../shared/payment-status.mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  const status = paymentStatusMapper.map(code, { onUnknown: 'unknown' });
  // 'unknown' guarantees we only get here with a known status or the
  // sentinel; the shared return type is wider than payouts' contract.
  return status as PayoutStatus;
}
