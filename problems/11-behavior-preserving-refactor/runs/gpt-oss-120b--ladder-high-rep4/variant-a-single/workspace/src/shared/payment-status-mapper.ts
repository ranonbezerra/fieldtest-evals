/**
 * Centralised mapper for provider status codes.
 *
 * The mapper knows the union of all provider codes used across the
 * application (orders, payouts, and reporting). Each public method preserves
 * the behaviour required by its original location:
 *
 * - `mapToOrderStatus` throws on unknown codes (orders module).
 * - `mapToPayoutStatus` returns `'unknown'` on unknown codes (payouts module).
 * - `mapToReportStatus` returns `null` on unknown codes and can apply the
 *   legacy upper‑casing quirk via the `legacyReportCasing` option
 *   (reporting script).
 */
export class PaymentStatusMapper {
  /**
   * Internal status values used by the application.
   */
  private static readonly internalStatuses = [
    'pending',
    'authorized',
    'paid',
    'refunded',
    'failed',
    'chargeback',
  ] as const;

  /**
   * Raw mapping from provider status to internal status.
   *
   * Returns `undefined` for unknown provider codes.
   */
  private static rawMapProviderStatus(code: string): (typeof this.internalStatuses)[number] | undefined {
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
        return 'failed';
      case 'CHARGEBACK':
        return 'chargeback';
      default:
        return undefined;
    }
  }

  /**
   * Mapping for the orders module.
   *
   * Mirrors the original behaviour: throws on unknown provider status.
   */
  static mapToOrderStatus(code: string): (typeof this.internalStatuses)[number] {
    const status = this.rawMapProviderStatus(code);
    if (status === undefined) {
      throw new Error(`unknown provider status: ${code}`);
    }
    return status;
  }

  /**
   * Mapping for the payouts module.
   *
   * Mirrors the original behaviour: returns `'unknown'` for unknown provider status.
   */
  static mapToPayoutStatus(code: string): string {
    const status = this.rawMapProviderStatus(code);
    return status ?? 'unknown';
  }

  /**
   * Mapping for the reporting script.
   *
   * Mirrors the original behaviour: returns `null` for unknown provider status.
   * When `legacyReportCasing` is true, the `"failed"` status is upper‑cased to
   * `"FAILED"` to keep the historic CSV format.
   */
  static mapToReportStatus(
    code: string,
    options?: { legacyReportCasing?: boolean },
  ): string | null {
    const status = this.rawMapProviderStatus(code);
    if (status === undefined) {
      return null;
    }
    if (options?.legacyReportCasing && status === 'failed') {
      return 'FAILED';
    }
    return status;
  }
}
