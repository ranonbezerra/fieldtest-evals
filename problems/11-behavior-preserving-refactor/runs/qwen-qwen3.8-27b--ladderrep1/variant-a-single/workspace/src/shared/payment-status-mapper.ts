// The single provider status -> internal status table for the whole repo.
//
// Three call sites used to keep their own drifted copies of this mapping;
// they all delegate to this mapper now:
//
//   - src/orders/orders.status.ts   (order detail screen; throws on unknown codes)
//   - src/payouts/payouts.status.ts (reconciliation; unknown codes -> 'unknown')
//   - scripts/reporting.ts          (nightly finance CSV; unknown codes are skipped)
//
// How each call site treats a code the table does not know (throw /
// 'unknown' / skip) is that call site's own contract. The divergence is
// deliberate and documented in NOTES.md -- do not unify it here.

export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/**
 * What `map` can return: the canonical statuses, plus the report-only
 * legacy value 'FAILED' (see PaymentStatusMapperOptions.legacyReportCasing).
 */
export type LegacyReportStatus = PaymentStatus | 'FAILED';

export interface PaymentStatusMapperOptions {
  /**
   * Reporting-only quirk. The nightly finance CSV has emitted 'FAILED'
   * (upper case) in its status column for DECLINED/EXPIRED since 2021, and
   * the finance team's spreadsheets filter on that exact value. The casing
   * is the format now, not a bug: do not normalise it away, do not make it
   * the default, and do not move it into a branch at the call site.
   *
   * scripts/reporting.ts is the only call site that passes this option.
   */
  legacyReportCasing?: boolean;
}

export class PaymentStatusMapper {
  constructor(private readonly options: PaymentStatusMapperOptions = {}) {}

  /**
   * Map a provider status code to the internal status.
   *
   * The table covers the union of every provider code any call site can
   * receive, including the two payout-only codes (PAYOUT_SETTLED,
   * PAYOUT_REVERSED). Returns null for a code the table does not know;
   * what to do about that null is the call site's own contract (see the
   * file header and NOTES.md).
   */
  map(code: string): LegacyReportStatus | null {
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
        // { legacyReportCasing: true } -> 'FAILED', the value the finance
        // CSV has been shipping for these two codes since 2021.
        return this.options.legacyReportCasing ? 'FAILED' : 'failed';
      case 'CHARGEBACK':
        return 'chargeback';
      default:
        return null;
    }
  }
}
