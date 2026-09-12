/**
 * Central mapper for provider status → internal status.
 *
 * It knows the union of all provider status codes used across the codebase.
 * Call‑sites customise the behaviour via {@link MapperOptions}.
 *
 * - {@link MapperOptions.legacyReportCasing} – reporting script needs the
 *   `"failed"` status upper‑cased as `"FAILED"`.
 * - {@link MapperOptions.unknownBehavior} – three call‑sites diverge on
 *   unknown codes:
 *     - `throw` → throw an error (orders)
 *     - `unknown` → return `"unknown"` (payouts)
 *     - `null` → return `null` (reporting, which then skips the row)
 */
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown'
  | 'FAILED';

export interface MapperOptions {
  /** Reporting script needs `"failed"` upper‑cased. */
  legacyReportCasing?: boolean;
  /**
   * How to handle unknown provider codes.
   * - `"throw"` – raise an exception.
   * - `"unknown"` – return the literal `"unknown"`.
   * - `"null"` – return `null` (caller can skip).
   */
  unknownBehavior?: 'throw' | 'unknown' | 'null';
}

/**
 * Map a provider status code to an internal status.
 *
 * @param code Provider status string.
 * @param options Customisation per call‑site.
 * @returns Mapped status or `null` when {@link MapperOptions.unknownBehavior}
 *          is `"null"`.
 */
export function mapProviderStatus(
  code: string,
  options: MapperOptions = {},
): PaymentStatus | null {
  const { legacyReportCasing = false, unknownBehavior = 'throw' } = options;

  const mapping: Record<string, PaymentStatus> = {
    // base mapping
    PENDING: 'pending',
    AWAITING_PAYMENT: 'pending',
    AUTHORIZED: 'authorized',
    CAPTURED: 'paid',
    SETTLED: 'paid',
    REFUNDED: 'refunded',
    PARTIAL_REFUND: 'refunded',
    DECLINED: 'failed',
    EXPIRED: 'failed',
    CHARGEBACK: 'chargeback',
    // payout‑specific codes
    PAYOUT_SETTLED: 'paid',
    PAYOUT_REVERSED: 'refunded',
  };

  if (code in mapping) {
    let status = mapping[code];
    if (status === 'failed' && legacyReportCasing) {
      // Only the reporting script wants this upper‑cased.
      return 'FAILED';
    }
    return status;
  }

  // Unknown code handling
  if (unknownBehavior === 'throw') {
    throw new Error(`unknown provider status: ${code}`);
  }
  if (unknownBehavior === 'unknown') {
    return 'unknown';
  }
  // 'null'
  return null;
}
