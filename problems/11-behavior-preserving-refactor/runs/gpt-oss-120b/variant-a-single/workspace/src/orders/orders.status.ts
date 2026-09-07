// Provider status -> internal status, for the order detail screen.
import { mapProviderStatus as sharedMap } from '../shared/payment-status-mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/**
 * Maps a provider status to an OrderStatus.
 * Unknown codes cause an exception (preserved from original behaviour).
 */
export function mapProviderStatus(code: string): OrderStatus {
  // sharedMap throws on unknown codes – exactly what we need.
  return sharedMap(code) as OrderStatus;
}
