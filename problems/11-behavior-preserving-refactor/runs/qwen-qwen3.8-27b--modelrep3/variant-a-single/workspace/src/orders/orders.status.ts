// Provider status -> internal status, for the order detail screen.
//
// Delegates to the shared PaymentStatusMapper. Orders keep their historical
// behavior on an unknown provider code: they throw (see NOTES.md — the
// consumers' unknown-code behaviors are intentionally not unified).

import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

// With onUnknown: 'throw' the mapper cannot return null, 'unknown' or
// 'FAILED' here, so the result is always an OrderStatus (hence the cast).
const mapper = new PaymentStatusMapper({ onUnknown: 'throw' });

export function mapProviderStatus(code: string): OrderStatus {
  return mapper.map(code) as OrderStatus;
}
