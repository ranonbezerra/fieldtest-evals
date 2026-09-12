import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

// Provider status -> internal status, for the order detail screen.
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/**
 * Wrapper around the shared mapper for the orders module.
 *
 * - Unknown provider codes throw (default behaviour of the shared mapper).
 * - No legacy CSV casing is applied.
 */
export function mapProviderStatus(code: string): OrderStatus {
  const result = sharedMapProviderStatus(code, { unknownBehavior: 'throw' });
  // The shared mapper never returns `null` when `unknownBehavior` is `'throw'`.
  return result as OrderStatus;
}
