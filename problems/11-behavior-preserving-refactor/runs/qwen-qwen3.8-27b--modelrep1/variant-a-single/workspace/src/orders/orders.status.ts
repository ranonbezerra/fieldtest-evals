// Provider status -> internal status, for the order detail screen.
//
// The mapping table now lives in the shared PaymentStatusMapper
// (src/shared/payment-status.mapper.ts). This module keeps the
// orders-facing contract: an unknown provider code throws.
// See NOTES.md for why the call sites are not unified on that.
import { PaymentStatusMapper } from '../shared/payment-status.mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

// Orders fail loudly: an unknown code is bad data, not something to bucket.
const mapper = new PaymentStatusMapper({ onUnknown: 'throw' });

export function mapProviderStatus(code: string): OrderStatus {
  const status = mapper.map(code);
  if (status === null || status === 'unknown' || status === 'FAILED') {
    // Unreachable: with onUnknown: 'throw', map() throws instead of
    // returning these values. The branch exists only to narrow the type
    // to OrderStatus.
    throw new Error(`unreachable: unknown provider status: ${code}`);
  }
  return status;
}
