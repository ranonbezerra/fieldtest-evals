// Shared provider-status → internal-status mapper.
// Covers the union of provider codes known across orders, payouts, and reporting.
// All three call sites delegate here.
//
// Unknown-code handling differs by caller and is deliberate:
//   - orders    → onUnknown: 'throw'    (errors loudly for the display layer)
//   - payouts   → onUnknown: 'unknown' (keeps reconciliation alive)
//   - reporting → onUnknown: 'null'    (skips the row in the CSV)
// See NOTES.md. Do not unify these without identifying every consumer.
export type UnknownHandling = 'throw' | 'unknown' | 'null';

export interface PaymentStatusMapperOptions {
  /**
   * When true, DECLINED and EXPIRED map to 'FAILED' (uppercase) instead of
   * 'failed'. Only the reporting call site uses this — CSV consumers depend
   * on the upper-cased value. Do not normalise away; do not make default.
   */
  legacyReportCasing?: boolean;
  onUnknown?: UnknownHandling;
}

export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {},
): string | null {
  const { legacyReportCasing = false, onUnknown = 'throw' } = options;

  switch (code) {
    case 'PENDING':
    case 'AWAITING_PAYMENT':
      return 'pending';
    case 'AUTHORIZED':
      return 'authorized';
    case 'CAPTURED':
    case 'SETTLED':
      return 'paid';
    case 'PAYOUT_SETTLED':
      return 'paid';
    case 'REFUNDED':
    case 'PARTIAL_REFUND':
      return 'refunded';
    case 'PAYOUT_REVERSED':
      return 'refunded';
    case 'DECLINED':
    case 'EXPIRED':
      return legacyReportCasing ? 'FAILED' : 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      return handleUnknown(code, onUnknown);
  }
}

function handleUnknown(code: string, onUnknown: UnknownHandling): string | null {
  if (onUnknown === 'throw') throw new Error(`unknown provider status: ${code}`);
  if (onUnknown === 'unknown') return 'unknown';
  return null;
}
