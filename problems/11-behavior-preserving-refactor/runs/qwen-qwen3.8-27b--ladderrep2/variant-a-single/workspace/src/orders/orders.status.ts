// Provider status -> internal status, for the order detail screen.
// Delegates to the shared PaymentStatusMapper (src/shared/payment-status-mapper.ts);
// the per-code mapping lives there, this file keeps only the orders contract.

import { PaymentStatusMapper, type PaymentStatus } from '../shared/payment-status-mapper.js';

export type OrderStatus = PaymentStatus;

const mapper = new PaymentStatusMapper();

export function mapProviderStatus(code: string): OrderStatus {
  // Orders contract: an unknown provider code is a data error, so it throws.
  // One of three deliberate unknown-code divergences — see NOTES.md.
  return mapper.map(code, { onUnknown: 'throw' });
}
