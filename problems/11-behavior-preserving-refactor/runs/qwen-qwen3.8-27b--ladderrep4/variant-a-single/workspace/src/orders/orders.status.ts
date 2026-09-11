// Provider status -> internal status, for the order detail screen.
//
// The mapping table now lives in the shared PaymentStatusMapper
// (src/shared/payment-status.mapper.ts); this file only keeps orders'
// contract. That contract is unchanged and deliberately different from the
// other call sites: unknown provider codes throw — see NOTES.md.
import { paymentStatusMapper } from '../shared/payment-status.mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  const status = paymentStatusMapper.map(code, { onUnknown: 'throw' });
  // 'throw' guarantees we only get here with a known status; the shared
  // return type is wider than orders' contract.
  return status as OrderStatus;
}
