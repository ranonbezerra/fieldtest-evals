import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

/**
 * Provider status → internal status, for payout reconciliation.
 *
 * Delegates to the shared {@link PaymentStatusMapper}. Unknown provider codes
 * result in `'unknown'`, matching the original behaviour.
 */
export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  return PaymentStatusMapper.mapToPayoutStatus(code) as PayoutStatus;
}
