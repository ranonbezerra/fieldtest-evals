// Central mapping of provider status codes to internal status strings.
// Different call‑sites need slightly different behaviours (error, unknown, null,
// legacy casing). Those differences are expressed via the MapperOptions.
//
// The mapping covers the union of all provider codes used in the project.
export type MapperOptions = {
  /** When true, the “failed” status is returned as upper‑cased “FAILED”.
   *  This is required only by the legacy reporting script. */
  legacyReportCasing?: boolean;
  /** When true, unknown provider codes are mapped to the literal string 'unknown'.
   *  Used by the payouts reconciliation flow. */
  unknownAsUnknown?: boolean;
  /** When true, unknown provider codes are mapped to null.
   *  Used by the reporting script so that rows can be skipped. */
  unknownAsNull?: boolean;
};

/**
 * Maps a provider status code to an internal status string.
 *
 * @param code Provider status code.
 * @param options Behavioural options for callers that need special handling.
 * @returns The internal status, or null / 'unknown' depending on options.
 *
 * @throws When the code is unknown and neither `unknownAsUnknown` nor
 *         `unknownAsNull` is set.
 */
export function mapProviderStatus(
  code: string,
  options?: MapperOptions,
): string | null {
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
      // Base mapping is 'failed', but legacy reporting wants upper‑cased.
      if (options?.legacyReportCasing) {
        return 'FAILED';
      }
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      if (options?.unknownAsUnknown) {
        return 'unknown';
      }
      if (options?.unknownAsNull) {
        return null;
      }
      throw new Error(`unknown provider status: ${code}`);
  }
}
