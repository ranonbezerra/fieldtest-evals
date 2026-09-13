// Provider status -> internal status, for the order detail screen.
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

export function mapProviderStatus(code: string): OrderStatus {
  // throwOnUnknown: the order detail screen treats unmapped codes as fatal.
  return sharedMapProviderStatus(code, { throwOnUnknown: true }) as OrderStatus;
}
