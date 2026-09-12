import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

// Provider status -> internal status, for payout reconciliation.
// Same provider, two extra codes this side of the integration can receive.
export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

/**
 * Wrapper around the shared mapper for the payouts module.
 *
 * - Unknown provider codes map to the string `'unknown'` (required for
 *   reconciliation to continue).
 * - No legacy CSV casing is applied.
 */
export function mapProviderStatus(code: string): PayoutStatus {
  const result = sharedMapProviderStatus(code, { unknownBehavior: 'return-unknown' });
  // The shared mapper never returns `null` when `unknownBehavior` is
  // `'return-unknown'`.
  return result as PayoutStatus;
}
