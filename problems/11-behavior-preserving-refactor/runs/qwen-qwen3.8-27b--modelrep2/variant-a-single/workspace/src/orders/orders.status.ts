// Provider status -> internal status, for the order detail screen.
//
// The table itself lives in src/shared/payment-status.mapper.ts. This module
// is a thin delegate that keeps the orders contract intact:
//   - the orders integration only ever received CORE_PROVIDER_CODES, so it
//     still throws on anything else (including the payout-only codes);
//   - the error message is unchanged: `unknown provider status: <code>`.

import {
  CORE_PROVIDER_CODES,
  PaymentStatusMapper,
} from '../shared/payment-status.mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

const mapper = new PaymentStatusMapper({
  unknownCodePolicy: 'throw',
  recognizedCodes: CORE_PROVIDER_CODES,
});

export function mapProviderStatus(code: string): OrderStatus {
  const status = mapper.map(code);
  if (status === null || status === 'unknown') {
    // Unreachable with `unknownCodePolicy: 'throw'` (the mapper throws
    // first); kept so TypeScript narrows `status` to `OrderStatus` without a
    // cast.
    throw new Error(`unknown provider status: ${code}`);
  }
  return status;
}
