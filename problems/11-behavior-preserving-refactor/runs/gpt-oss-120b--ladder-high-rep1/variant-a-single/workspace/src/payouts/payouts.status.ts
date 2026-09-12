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

export function mapProviderStatus(code: string): PayoutStatus {
  // Payouts accept the extra payout‑specific codes and return 'unknown' for any truly unknown code.
  const status = sharedMapProviderStatus(code, {
    unknown: 'unknown',
    allowExtraCodes: true,
  });
  return status as PayoutStatus;
}
