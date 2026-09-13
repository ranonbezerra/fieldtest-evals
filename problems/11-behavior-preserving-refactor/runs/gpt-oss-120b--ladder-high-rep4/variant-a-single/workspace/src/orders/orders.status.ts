import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

/**
 * Provider status → internal status, for the order detail screen.
 *
 * Delegates to the shared {@link PaymentStatusMapper}. Unknown provider codes
 * result in an exception, matching the original behaviour.
 */
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  // The shared mapper throws on unknown codes.
  return PaymentStatusMapper.mapToOrderStatus(code) as OrderStatus;
}
