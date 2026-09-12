/**
 * Centralised mapping of provider status codes to internal payment statuses.
 *
 * The mapper is used by three distinct call‑sites (orders, payouts, reporting)
 * which each require slightly different behaviour for unknown codes and for a
 * legacy CSV quirk. The mapper’s options allow each consumer to specify the
 * required contract while keeping the actual mapping logic in one place.
 */
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export interface PaymentStatusMapperOptions {
  /**
   * Determines how to handle a provider status that is not recognised.
   *
   * - `'throw'` – throws an `Error` (default for the orders module).
   * - `'return-unknown'` – returns the string `'unknown'` (payouts module).
   * - `'skip'` – returns `null`, signalling the caller to ignore the value
   *   (reporting script).
   */
  unknownBehavior?: 'throw' | 'return-unknown' | 'skip';
  /**
   * When true, the status `'failed'` is returned as uppercase `'FAILED'`.
   *
   * This matches the historic CSV format used by the finance team and is
   * required only by the reporting script.
   */
  legacyReportCasing?: boolean;
}

/**
 * Maps a provider status code to an internal payment status.
 *
 * @param code    Provider status string.
 * @param options Mapping options.
 *
 * @returns The mapped status string, or `null` if `unknownBehavior` is `'skip'`.
 *
 * @throws When `unknownBehavior` is `'throw'` and `code` is not known.
 */
export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {}
): string | null {
  const { unknownBehavior = 'throw', legacyReportCasing = false } = options;

  switch (code) {
    case 'PENDING':
    case 'AWAITING_PAYMENT':
      return 'pending';
    case 'AUTHORIZED':
      return 'authorized';
    case 'CAPTURED':
    case 'SETTLED':
    case 'PAYOUT_SETTLED':
      return 'paid';
    case 'REFUNDED':
    case 'PARTIAL_REFUND':
    case 'PAYOUT_REVERSED':
      return 'refunded';
    case 'DECLINED':
    case 'EXPIRED':
      // Base status is 'failed'; apply legacy casing if requested.
      if (legacyReportCasing) {
        return 'FAILED';
      }
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      // Unknown provider status.
      if (unknownBehavior === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      if (unknownBehavior === 'return-unknown') {
        return 'unknown';
      }
      // 'skip' or any other value – return null so the caller can ignore.
      return null;
  }
}
