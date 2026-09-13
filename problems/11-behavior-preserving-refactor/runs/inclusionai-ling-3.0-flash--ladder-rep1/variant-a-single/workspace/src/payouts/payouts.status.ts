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

import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

export function mapProviderStatus(code: string): PayoutStatus {
  // resolveUnknown: reconciliation must not stop on a code we have not seen yet.
  return sharedMapProviderStatus(code, { resolveUnknown: true }) as PayoutStatus;
}
