// Single source of truth for the provider status -> internal status table.
//
// Before the extraction this table was copy-pasted in three places:
//   - src/orders/orders.status.ts   (threw on unrecognized codes)
//   - src/payouts/payouts.status.ts (bucketed them as 'unknown')
//   - scripts/reporting.ts          (skipped them from the CSV and
//                                    upper-cased 'failed' to 'FAILED')
// The table is unified here. The per-call-site behavior around
// unrecognized codes is deliberately NOT unified; each call site configures
// the mapper to behave exactly as it did before. See NOTES.md.

/** Internal statuses shared by all three call sites. */
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/** Provider codes every integration receives. */
export const CORE_PROVIDER_CODES = [
  'PENDING',
  'AWAITING_PAYMENT',
  'AUTHORIZED',
  'CAPTURED',
  'SETTLED',
  'REFUNDED',
  'PARTIAL_REFUND',
  'DECLINED',
  'EXPIRED',
  'CHARGEBACK',
] as const;

/** Provider codes only the payout integration receives. */
export const PAYOUT_ONLY_PROVIDER_CODES = [
  'PAYOUT_SETTLED',
  'PAYOUT_REVERSED',
] as const;

/** The union of provider codes: everything the mapper knows. */
export const ALL_PROVIDER_CODES = [
  ...CORE_PROVIDER_CODES,
  ...PAYOUT_ONLY_PROVIDER_CODES,
] as const;

export type ProviderCode = (typeof ALL_PROVIDER_CODES)[number];

// The unified table. `Record<ProviderCode, ...>` makes TypeScript fail the
// build if a code is added to the union without an entry here (or vice versa).
const BASE_STATUS: Record<ProviderCode, PaymentStatus> = {
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

/**
 * What `map` does with a code the call site does not recognize.
 * The three call sites intentionally differ (see NOTES.md); do not unify:
 *  - 'throw'       orders: an unrecognized code is a data error; fail loudly.
 *  - 'markUnknown' payouts: reconciliation must keep running; the record is
 *                  bucketed as 'unknown' and lands in `unresolved`.
 *  - 'skip'        reporting: the row is left out of the nightly CSV.
 */
export type UnknownCodePolicy = 'throw' | 'markUnknown' | 'skip';

export interface PaymentStatusMapperOptions {
  /** How codes the call site does not recognize are handled. */
  unknownCodePolicy: UnknownCodePolicy;

  /**
   * Legacy report quirk, preserved on purpose: the nightly CSV has emitted
   * the upper-cased 'FAILED' for DECLINED/EXPIRED since 2021, and finance's
   * spreadsheet filters on exactly that value. Only the reporting call site
   * opts in. Do not "fix" the casing without changing those consumers first.
   */
  legacyReportCasing?: boolean;

  /**
   * Provider codes this call site's integration can actually receive.
   * Defaults to the full union. The orders and reporting call sites pass
   * CORE_PROVIDER_CODES so that codes they never handled before the
   * extraction keep their pre-existing behavior (throw / skip).
   */
  recognizedCodes?: readonly string[];
}

/**
 * Result of `map`:
 *  - `PaymentStatus`  a code the call site recognizes
 *  - `'FAILED'`       the legacy upper-cased variant (only when
 *                     `legacyReportCasing` is enabled)
 *  - `'unknown'`      unrecognized, with policy 'markUnknown'
 *  - `null`           unrecognized, with policy 'skip'
 * With policy 'throw', unrecognized codes never come back: `map` throws
 * `Error('unknown provider status: <code>')`, the message orders used.
 */
export type MappedPaymentStatus = PaymentStatus | 'FAILED' | 'unknown' | null;

export class PaymentStatusMapper {
  private readonly policy: UnknownCodePolicy;
  private readonly legacyReportCasing: boolean;
  private readonly recognized: ReadonlySet<string>;

  constructor(options: PaymentStatusMapperOptions) {
    this.policy = options.unknownCodePolicy;
    this.legacyReportCasing = options.legacyReportCasing ?? false;
    this.recognized = new Set(options.recognizedCodes ?? ALL_PROVIDER_CODES);
  }

  map(code: string): MappedPaymentStatus {
    const status = this.recognizedStatus(code);

    if (status === null) {
      switch (this.policy) {
        case 'throw':
          throw new Error(`unknown provider status: ${code}`);
        case 'markUnknown':
          return 'unknown';
        case 'skip':
          return null;
      }
    }

    if (this.legacyReportCasing && status === 'failed') {
      // 'FAILED' casing is the legacy quirk finance's spreadsheet depends on
      // (see `legacyReportCasing`).
      return 'FAILED';
    }
    return status;
  }

  private recognizedStatus(code: string): PaymentStatus | null {
    if (!this.recognized.has(code)) {
      return null;
    }
    // `recognized` is meant to be a subset of the mapper's union, so a hit
    // here is a key of BASE_STATUS; the `?? null` only covers a
    // programmatically constructed mapper whose set is out of sync.
    return BASE_STATUS[code as ProviderCode] ?? null;
  }
}
