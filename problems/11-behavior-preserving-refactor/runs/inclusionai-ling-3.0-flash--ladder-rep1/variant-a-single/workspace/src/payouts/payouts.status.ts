// Provider status -> internal status, for payout reconciliation.
// Same provider, two extra codes this side of the integration can receive.
import { mapProviderStatus as mapSharedStatus } from '../shared/payment-status-mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  return mapSharedStatus(code, { onUnknown: 'unknown' }) as PayoutStatus;
}
