import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';
import type { InternalPaymentStatus } from '../shared/payment-status-mapper.js';

/**
 * Public type for Payout status. Includes the special `"unknown"` value used
 * during reconciliation.
 */
export type PayoutStatus = InternalPaymentStatus | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  // Payouts treat unknown codes as `"unknown"` so reconciliation can continue.
  const result = sharedMapProviderStatus(code, { unknownHandling: 'unknown' });
  // The cast is safe because `'unknown'` handling never yields `null` or `'FAILED'`.
  return result as PayoutStatus;
}
