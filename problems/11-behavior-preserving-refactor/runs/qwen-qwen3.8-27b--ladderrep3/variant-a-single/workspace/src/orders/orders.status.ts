// Provider status -> internal status, for the order detail screen.
//
// The mapping table lives in the shared PaymentStatusMapper (src/shared/).
// This module keeps the orders-side contract: an unknown provider status is
// a data error and throws, exactly as this copy did before the extraction.
import { PaymentStatusMapper, type PaymentStatus } from '../shared/payment-status.mapper.js';

export type OrderStatus = PaymentStatus;

// onUnknownCode: 'throw' preserves the pre-extraction orders behaviour:
// toView() rejects on a code the mapping does not know.
const mapper = new PaymentStatusMapper({ onUnknownCode: 'throw' });

export function mapProviderStatus(code: string): OrderStatus {
  // This instance is configured with onUnknownCode: 'throw' and
  // legacyReportCasing: false, so it either throws or returns one of the
  // canonical statuses above.
  return mapper.map(code) as OrderStatus;
}
