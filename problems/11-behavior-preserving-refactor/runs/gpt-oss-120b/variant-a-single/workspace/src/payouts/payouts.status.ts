// Provider status -> internal status, for payout reconciliation.
// Includes two extra provider codes that only payouts can receive.
import { mapProviderStatus as sharedMap } from '../shared/payment-status-mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

/**
 * Maps a provider status to a PayoutStatus.
 * Unknown codes are mapped to the literal string 'unknown' (preserved behaviour).
 */
export function mapProviderStatus(code: string): PayoutStatus {
  return sharedMap(code, { unknownAsUnknown: true }) as PayoutStatus;
}
