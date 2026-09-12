// Shared mapper for provider status → internal status.
// Covers the union of all provider codes used by orders, payouts, and reporting.
// Call sites can customise behaviour via options.

export type InternalStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export interface PaymentStatusMapperOptions {
  /**
   * How to handle unknown provider codes.
   *
   * - 'throw' (default) – throws an Error.
   * - 'unknown' – returns the literal string `'unknown'`.
   * - 'skip' – returns `null`, signalling the caller to ignore the entry.
   */
  unknown?: 'throw' | 'unknown' | 'skip';
  /**
   * When true, maps `DECLINED` and `EXPIRED` to the upper‑cased string `'FAILED'`
   * for the legacy reporting CSV format.
   */
  legacyReportCasing?: boolean;
  /**
   * Whether to recognise payout‑specific provider codes (`PAYOUT_SETTLED`,
   * `PAYOUT_REVERSED`). When false (default) those codes are treated as unknown.
   */
  allowExtraCodes?: boolean;
}

/**
 * Map a provider status code to an internal status string.
 *
 * @param code Provider status code.
 * @param options Configuration options.
 * @returns Internal status string, or `null` if `unknown` handling is `'skip'`.
 * @throws If `unknown` handling is `'throw'` and the code is not recognised.
 */
export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {}
): string | null {
  const {
    unknown = 'throw',
    legacyReportCasing = false,
    allowExtraCodes = false,
  } = options;

  // Base mapping – common to all three call‑sites.
  const baseMap: Record<string, InternalStatus> = {
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
  };

  // Extra mapping – only the payouts domain knows about these codes.
  const extraMap: Record<string, InternalStatus> = {
    PAYOUT_SETTLED: 'paid',
    PAYOUT_REVERSED: 'refunded',
  };

  // Resolve the status from the appropriate map.
  let status: InternalStatus | undefined = baseMap[code];
  if (status === undefined && allowExtraCodes) {
    status = extraMap[code];
  }

  if (status !== undefined) {
    // Apply the legacy report casing quirk when requested.
    if (legacyReportCasing && (code === 'DECLINED' || code === 'EXPIRED')) {
      return 'FAILED';
    }
    return status;
  }

  // Unknown provider code handling.
  switch (unknown) {
    case 'skip':
      return null;
    case 'unknown':
      return 'unknown';
    case 'throw':
    default:
      throw new Error(`unknown provider status: ${code}`);
  }
}
