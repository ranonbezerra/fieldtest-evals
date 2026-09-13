// Provider status -> internal status, unified mapping table.
// All call sites delegate here; see NOTES.md for per-site behaviour notes.

export type InternalStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown'
  | 'FAILED'
  | null;

export interface MapperOptions {
  /**
   * When true, a provider code not present in the mapping table causes a throw.
   * Used by the orders module — the order detail screen treats unmapped codes
   * as a fatal integration problem.
   */
  throwOnUnknown?: boolean;
  /**
   * When true, a provider code not present in the mapping table resolves to
   * the literal 'unknown'.
   * Used by the payouts module — reconciliation must tolerate new provider
   * codes without crashing.
   */
  resolveUnknown?: boolean;
  /**
   * When true, DECLINED and EXPIRED map to 'FAILED' (uppercase) instead of
   * 'failed' (lowercase).
   * This is a legacy quirk that the finance CSV consumers depend on.
   * Only the reporting call site uses it. Do not make this the default.
   */
  legacyReportCasing?: boolean;
}

const STATUS_TABLE: Record<string, InternalStatus> = {
  PENDING: 'pending',
  AWAITING_PAYMENT: 'pending',
  AUTHORIZED: 'authorized',
  CAPTURED: 'paid',
  SETTLED: 'paid',
  PAYOUT_SETTLED: 'paid',
  REFUNDED: 'refunded',
  PARTIAL_REFUND: 'refunded',
  PAYOUT_REVERSED: 'refunded',
  DECLINED: 'failed',
  EXPIRED: 'failed',
  CHARGEBACK: 'chargeback',
};

export function mapProviderStatus(
  code: string,
  options: MapperOptions = {},
): InternalStatus {
  const mapped = STATUS_TABLE[code];

  if (mapped === undefined) {
    if (options.throwOnUnknown) {
      throw new Error(`unknown provider status: ${code}`);
    }
    if (options.resolveUnknown) {
      return 'unknown';
    }
    return null;
  }

  if (options.legacyReportCasing && (code === 'DECLINED' || code === 'EXPIRED')) {
    return 'FAILED';
  }

  return mapped;
}
