// Provider status -> internal status, for the order detail screen.
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  switch (code) {
    case 'PENDING':
    case 'AWAITING_PAYMENT':
      return 'pending';
    case 'AUTHORIZED':
      return 'authorized';
    case 'CAPTURED':
    case 'SETTLED':
      return 'paid';
    case 'REFUNDED':
    case 'PARTIAL_REFUND':
      return 'refunded';
    case 'DECLINED':
    case 'EXPIRED':
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      throw new Error(`unknown provider status: ${code}`);
  }
}
