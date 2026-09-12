import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

// Provider status -> internal status, for the order detail screen.
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  // Orders treat unknown codes as fatal errors.
  const status = sharedMapProviderStatus(code, { unknown: 'throw' });
  // The shared mapper guarantees the result matches OrderStatus when it does not throw.
  return status as OrderStatus;
}
