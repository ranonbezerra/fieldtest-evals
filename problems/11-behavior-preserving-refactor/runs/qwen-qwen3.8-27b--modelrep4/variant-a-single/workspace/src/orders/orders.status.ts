// Provider status -> internal status, for the order detail screen.
// Thin delegate to the shared PaymentStatusMapper; the local copy of the
// switch table was removed during the extraction.
import { PaymentStatusMapper } from '../shared/payment-status.mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

const mapper = new PaymentStatusMapper();

export function mapProviderStatus(code: string): OrderStatus {
  const status = mapper.map(code);
  if (status === null) {
    // Orders policy: the order detail screen has no fallback, so an unmapped
    // code throws (exactly as the local table did before the extraction).
    throw new Error(`unknown provider status: ${code}`);
  }
  if (status === 'FAILED') {
    // Unreachable: this mapper is constructed without legacyReportCasing.
    // Fail loudly rather than mislabel an order if that ever changes.
    throw new Error(`legacy report casing is not valid for orders: ${code}`);
  }
  return status;
}
