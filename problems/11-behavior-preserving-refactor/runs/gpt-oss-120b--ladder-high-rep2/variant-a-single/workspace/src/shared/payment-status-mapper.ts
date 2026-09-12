/**
 * Shared mapper for provider status codes → internal payment status.
 *
 * The mapper supports three behaviours for unknown provider codes:
 * - `throw`  – throws an Error (used by the Orders module).
 * - `unknown` – returns the literal string `"unknown"` (used by the Payouts module).
 * - `skip`   – returns `null` (used by the Reporting script to drop rows).
 *
 * In addition, the reporting script historically upper‑cased the status for
 * `DECLINED` and `EXPIRED`. That quirk is exposed via the
 * `legacyReportCasing` option.
 */

export type InternalPaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export type PaymentStatus = InternalPaymentStatus | 'unknown' | 'FAILED';

export interface PaymentStatusMapperOptions {
  /**
   * Controls how unknown provider codes are handled.
   *
   * - `"throw"`  – throw an Error (default for Orders).
   * - `"unknown"` – return `"unknown"` (default for Payouts).
   * - `"skip"`   – return `null` (default for Reporting).
   */
  unknownHandling?: 'throw' | 'unknown' | 'skip';
  /**
   * When `true`, the mapper returns the legacy upper‑cased `"FAILED"` for
   * provider codes `DECLINED` and `EXPIRED`. Only the Reporting script passes
   * this option.
   */
  legacyReportCasing?: boolean;
}

/**
 * Maps a provider status code to an internal payment status.
 *
 * @param code    Provider status code.
 * @param options Optional behaviour customisation.
 * @returns The mapped status, `"unknown"` or `null` when unknown handling
 *          dictates it.
 */
export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {}
): PaymentStatus | null {
  const { legacyReportCasing = false } = options;

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
      // Legacy reporting expects upper‑cased "FAILED".
      return legacyReportCasing ? 'FAILED' : 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
  }

  // Unknown provider status.
  const unknownHandling = options.unknownHandling ?? 'throw';
  switch (unknownHandling) {
    case 'unknown':
      return 'unknown';
    case 'skip':
      return null;
    case 'throw':
    default:
      throw new Error(`unknown provider status: ${code}`);
  }
}
