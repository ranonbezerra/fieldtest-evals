// Provider status -> internal status, for payout reconciliation.
// Same provider, two extra codes this side of the integration can receive.
import { mapProviderStatus as sharedMap } from '../shared/payment-status-mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargebook'
  | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  // Payouts must return "unknown" for unseen codes.
  const result = sharedMap(code, { unknownBehavior: 'unknown' });
  return result as PayoutStatus;
}
