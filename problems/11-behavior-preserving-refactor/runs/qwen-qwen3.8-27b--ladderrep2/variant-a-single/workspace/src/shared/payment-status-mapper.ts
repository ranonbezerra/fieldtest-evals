// The single provider-status -> internal-status mapping for the repo.
//
// It covers the union of provider codes across the three former copies:
//   - orders    (src/orders/orders.status.ts)
//   - payouts   (src/payouts/payouts.status.ts)
//   - reporting (scripts/reporting.ts)
//
// `mapBase` below is the only place the per-code mapping lives. Call sites
// delegate here and keep only their own unknown-code policy via the
// `onUnknown` option; that divergence is deliberate (see NOTES.md).

/** The internal statuses the base mapping can produce. */
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/**
 * The reporting copy's spelling of the same set: the failed bucket
 * (DECLINED / EXPIRED) is upper-cased to 'FAILED'.
 *
 * The finance team's spreadsheets have filtered on the upper-cased value in
 * the CSV status column since 2021. The casing is the file format, not a
 * bug; it is preserved via `legacyReportCasing`, never normalised.
 */
export type LegacyReportStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'FAILED'
  | 'chargeback';

/**
 * What a call site does with a provider code the mapping does not know.
 *
 * The three call sites deliberately disagree (see NOTES.md — do not unify):
 *   - 'throw'   orders: an unknown status is a data error, fail loudly
 *   - 'unknown' payouts: reconciliation must not stop, book as unresolved
 *   - 'skip'    reporting: the row is dropped from the CSV
 */
export type UnknownCodePolicy = 'throw' | 'unknown' | 'skip';

export interface PaymentStatusMapperOptions {
  onUnknown: UnknownCodePolicy;
  /**
   * legacyReportCasing — when true, the failed bucket comes back as
   * upper-cased 'FAILED' instead of 'failed'. Only the reporting call site
   * passes this; see `LegacyReportStatus` for why the quirk exists. It is
   * never the default.
   */
  legacyReportCasing?: boolean;
}

export class PaymentStatusMapper {
  map(
    code: string,
    options: { onUnknown: 'throw'; legacyReportCasing?: false },
  ): PaymentStatus;
  map(
    code: string,
    options: { onUnknown: 'throw'; legacyReportCasing: true },
  ): LegacyReportStatus;
  map(
    code: string,
    options: { onUnknown: 'unknown'; legacyReportCasing?: false },
  ): PaymentStatus | 'unknown';
  map(
    code: string,
    options: { onUnknown: 'unknown'; legacyReportCasing: true },
  ): LegacyReportStatus | 'unknown';
  map(
    code: string,
    options: { onUnknown: 'skip'; legacyReportCasing?: false },
  ): PaymentStatus | null;
  map(
    code: string,
    options: { onUnknown: 'skip'; legacyReportCasing: true },
  ): LegacyReportStatus | null;
  map(
    code: string,
    options: PaymentStatusMapperOptions,
  ): PaymentStatus | LegacyReportStatus | 'unknown' | null {
    const base = this.mapBase(code);
    if (base === null) {
      if (options.onUnknown === 'throw') {
        // The error the orders copy always threw, message unchanged.
        throw new Error(`unknown provider status: ${code}`);
      }
      if (options.onUnknown === 'unknown') {
        return 'unknown';
      }
      return null; // 'skip'
    }
    if (options.legacyReportCasing && base === 'failed') {
      // The reporting quirk: finance's CSV filters on 'FAILED' upper-cased.
      return 'FAILED';
    }
    return base;
  }

  /**
   * The provider code -> base status table, the only mapping switch in the
   * repo. Returns null for codes outside the union; `map` decides what null
   * means via `onUnknown`.
   */
  private mapBase(code: string): PaymentStatus | null {
    switch (code) {
      case 'PENDING':
      case 'AWAITING_PAYMENT':
        return 'pending';
      case 'AUTHORIZED':
        return 'authorized';
      case 'CAPTURED':
      case 'SETTLED':
      // Payout-specific codes; part of the union, known to every call site.
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
        return null;
    }
  }
}
