// Provider status -> internal status, for payout reconciliation.
// Same provider, two extra codes this side of the integration can receive.
//
// The table itself lives in src/shared/payment-status.mapper.ts. This module
// is a thin delegate that keeps the payouts contract intact:
//   - payouts is the only call site that recognizes the two payout-only
//     provider codes, so it runs with the mapper's full union;
//   - reconciliation must not stop on a code we have not seen yet, so
//     anything unrecognized comes back as 'unknown'.

import {
  ALL_PROVIDER_CODES,
  PaymentStatusMapper,
} from '../shared/payment-status.mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

const mapper = new PaymentStatusMapper({
  unknownCodePolicy: 'markUnknown',
  recognizedCodes: ALL_PROVIDER_CODES,
});

export function mapProviderStatus(code: string): PayoutStatus {
  const status = mapper.map(code);
  if (status === null) {
    // Unreachable with `unknownCodePolicy: 'markUnknown'`; kept for the
    // narrowing and as a coherent fallback.
    return 'unknown';
  }
  return status;
}
