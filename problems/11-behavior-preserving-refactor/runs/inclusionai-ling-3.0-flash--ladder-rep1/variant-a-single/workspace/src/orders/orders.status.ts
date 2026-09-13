// Provider status -> internal status, for the order detail screen.
import { mapProviderStatus as mapSharedStatus } from '../shared/payment-status-mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  return mapSharedStatus(code, { onUnknown: 'throw' }) as OrderStatus;
}
