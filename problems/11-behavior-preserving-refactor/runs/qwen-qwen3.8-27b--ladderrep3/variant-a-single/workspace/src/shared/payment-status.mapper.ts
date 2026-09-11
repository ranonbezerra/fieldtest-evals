// The single provider status -> internal status mapping for the whole
// marketplace.
//
// Before this file, the mapping was copied in three places and had drifted:
//   - src/orders/orders.status.ts   threw on unknown codes
//   - src/payouts/payouts.status.ts returned 'unknown' (plus two payout-only
//                                   codes)
//   - scripts/reporting.ts          returned null (the row is skipped) and
//                                   upper-cased the failed codes to 'FAILED'
// All three call sites now delegate to this mapper; the table in
// lookupProviderStatus() is the union of the provider codes they used to
// know. The per-call-site differences are options, not branches hidden in
// the call sites. The unknown-code divergence is deliberate — see NOTES.md.

export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/**
 * What to do with a provider code the table does not know.
 *
 * Each of the three call sites accumulated its own behaviour and its own
 * consumers depend on it, so this is a per-call-site option:
 *   'throw'   orders  -- the order detail screen fails loudly
 *   'unknown' payouts -- reconciliation buckets the record as unresolved
 *   'skip'    report  -- map() returns null and the row is dropped from the CSV
 *
 * Deliberately not unified. See NOTES.md for what must be checked first.
 */
export type UnknownCodePolicy = 'throw' | 'unknown' | 'skip';

export interface PaymentStatusMapperOptions {
  /**
   * Legacy casing of the nightly finance report: the failed codes
   * ('DECLINED', 'EXPIRED') are emitted as upper-cased 'FAILED' instead of
   * 'failed'.
   *
   * finance's spreadsheets have filtered on the upper-cased value in the
   * CSV's status column since 2021, so this casing is a format, not a bug.
   * Only scripts/reporting.ts passes `legacyReportCasing: true`. It must
   * stay opt-in: do not normalise it away, do not make it the default.
   */
  legacyReportCasing?: boolean;

  /**
   * Unknown-code policy. Deliberately per call site; see the
   * UnknownCodePolicy docs and NOTES.md before touching this.
   */
  onUnknownCode?: UnknownCodePolicy;
}

export class PaymentStatusMapper {
  private readonly legacyReportCasing: boolean;
  private readonly onUnknownCode: UnknownCodePolicy;

  constructor(options: PaymentStatusMapperOptions = {}) {
    this.legacyReportCasing = options.legacyReportCasing ?? false;
    this.onUnknownCode = options.onUnknownCode ?? 'throw';
  }

  /**
   * Maps a provider status code to the internal status.
   *
   * The return type is the join of every configuration's output; a given
   * instance only produces the subset its options allow (an instance with
   * onUnknownCode: 'throw' never returns null or 'unknown', and an instance
   * without legacyReportCasing never returns 'FAILED').
   */
  map(code: string): PaymentStatus | 'unknown' | 'FAILED' | null {
    const status = lookupProviderStatus(code);
    if (status !== undefined) {
      // The reporting quirk: the failed codes are upper-cased for the CSV.
      // Only the reporting call site opts into it.
      if (this.legacyReportCasing && status === 'failed') {
        return 'FAILED';
      }
      return status;
    }
    switch (this.onUnknownCode) {
      case 'unknown':
        return 'unknown';
      case 'skip':
        return null;
      case 'throw':
        throw new Error(`unknown provider status: ${code}`);
    }
  }
}

/**
 * The union of provider codes across the orders, payouts, and reporting
 * call sites. PAYOUT_SETTLED and PAYOUT_REVERSED only arrive on the payouts
 * side of the integration in practice; the other call sites now map them
 * instead of treating them as unknown (see NOTES.md).
 */
function lookupProviderStatus(code: string): PaymentStatus | undefined {
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
