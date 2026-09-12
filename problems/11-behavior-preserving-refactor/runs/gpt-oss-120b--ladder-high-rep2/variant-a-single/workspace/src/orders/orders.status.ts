import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';
import type { InternalPaymentStatus } from '../shared/payment-status-mapper.js';

/**
 * Public type for Order status. Mirrors the internal statuses without the
 * legacy `"FAILED"` or `"unknown"` variants.
 */
export type OrderStatus = InternalPaymentStatus;

export function mapProviderStatus(code: string): OrderStatus {
  // Orders treat unknown codes as an error.
  const result = sharedMapProviderStatus(code, { unknownHandling: 'throw' });
  // The cast is safe because the `'throw'` handling never yields `null` or
  // `'unknown'`/`'FAILED'`.
  return result as OrderStatus;
}
