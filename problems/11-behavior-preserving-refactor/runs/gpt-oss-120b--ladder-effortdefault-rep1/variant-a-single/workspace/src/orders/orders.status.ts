// Provider status -> internal status, for the order detail screen.
import { mapProviderStatus as sharedMap } from '../shared/payment-status-mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  // Orders must throw on unknown codes.
  const result = sharedMap(code, { unknownBehavior: 'throw' });
  // The mapper will never return null or "unknown" for this option.
  return result as OrderStatus;
}
