// Single source of truth for the provider-status -> internal-status mapping.
//
// This table used to be copy-pasted in three places: src/orders/orders.status.ts,
// src/payouts/payouts.status.ts and scripts/reporting.ts. The copies disagreed
// on two things on purpose; rather than unify them, the mapper expresses both
// as options so each call site keeps its historical behaviour exactly.
// See NOTES.md.

/** The six canonical internal statuses shared by every call site. */
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/** What map() does with a provider code outside the known set. */
export type UnknownCodePolicy = 'throw' | 'returnUnknown' | 'returnNull';

export interface PaymentStatusMapperOptions {
  /**
   * Behaviour for codes outside the union of known provider codes.
   * Historically:
   *   'throw'         — orders: fail loudly on bad data
   *   'returnUnknown' — payouts: reconciliation buckets it under 'unknown'
   *   'returnNull'    — reporting: the row is dropped from the CSV
   * The divergence is intentional and must not be unified; see NOTES.md.
   * Defaults to 'throw'.
   */
  onUnknown?: UnknownCodePolicy;

  /**
   * Reporting-only quirk (see NOTES.md): the nightly CSV's status column has
   * carried upper-cased 'FAILED' for DECLINED/EXPIRED since 2021, and
   * finance's spreadsheets filter on that casing. Only the reporting call
   * site sets this option; every other call site keeps lowercase 'failed'.
   */
  legacyReportCasing?: boolean;
}

/**
 * Everything map() can return:
 *   - the canonical statuses (PaymentStatus)
 *   - 'FAILED'  — only with legacyReportCasing: true
 *   - 'unknown' — only with onUnknown: 'returnUnknown'
 *   - null      — only with onUnknown: 'returnNull'
 */
export type PaymentStatusResult = PaymentStatus | 'FAILED' | 'unknown' | null;

export class PaymentStatusMapper {
  constructor(private readonly options: PaymentStatusMapperOptions = {}) {}

  /**
   * Maps a raw provider status code to an internal status.
   *
   * Unknown-code handling follows `options.onUnknown`; DECLINED/EXPIRED
   * respect `options.legacyReportCasing`.
   */
  map(code: string): PaymentStatusResult {
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
        // Legacy report quirk: 'FAILED' here is load-bearing for finance's
        // spreadsheets. See NOTES.md before touching this line.
        return this.options.legacyReportCasing ? 'FAILED' : 'failed';
      case 'CHARGEBACK':
        return 'chargeback';
    }

    // Code outside the union: preserve each call site's historical behaviour.
    switch (this.options.onUnknown ?? 'throw') {
      case 'throw':
        throw new Error(`unknown provider status: ${code}`);
      case 'returnUnknown':
        return 'unknown';
      case 'returnNull':
        return null;
    }
  }
}
