// Single source of truth for provider-status -> internal-status mapping.
//
// Replaces the three hand-kept copies that used to live in
// src/orders/orders.status.ts, src/payouts/payouts.status.ts and
// scripts/reporting.ts. The three call sites now delegate here.
//
// The mapper knows the UNION of provider codes any call site can receive,
// including the two payout-only codes PAYOUT_SETTLED and PAYOUT_REVERSED.
//
// What an UNMAPPED (unknown) code does is deliberately not the mapper's job:
// map() returns null and each call site keeps its own historical policy
// (orders throws, payouts records 'unknown', the report skips the row).
// The policies diverged on purpose before this extraction and the call sites
// depend on it; see NOTES.md. Do not unify.

export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/**
 * Failure status as emitted for the nightly finance report. The report's
 * spreadsheets (in use since 2021) filter on this exact upper-cased value,
 * so it is kept even though every other call site uses 'failed'.
 */
export const LEGACY_REPORT_FAILURE = 'FAILED' as const;

/**
 * Everything map() can return for a known code: the canonical statuses, plus
 * LEGACY_REPORT_FAILURE when the mapper was constructed with
 * { legacyReportCasing: true }.
 */
export type MappedPaymentStatus = PaymentStatus | typeof LEGACY_REPORT_FAILURE;

export interface PaymentStatusMapperOptions {
  /**
   * Legacy report casing: map DECLINED/EXPIRED to 'FAILED' instead of
   * 'failed'. This exists solely for the nightly CSV in scripts/reporting.ts,
   * whose consumers filter on the upper-cased value, and the report is the
   * ONLY call site that enables it. Every other call site constructs the
   * mapper with no options and must only ever see lowercase statuses.
   */
  legacyReportCasing?: boolean;
}

export class PaymentStatusMapper {
  private readonly legacyReportCasing: boolean;

  constructor(options: PaymentStatusMapperOptions = {}) {
    this.legacyReportCasing = options.legacyReportCasing === true;
  }

  /**
   * Maps a provider status code to its internal status.
   *
   * Returns null for codes outside the union of known provider codes. Each
   * call site decides what null means (throw / 'unknown' / skip) and keeps
   * that decision in its own thin delegate — see NOTES.md.
   */
  map(code: string): MappedPaymentStatus | null {
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
        // The report casing quirk, preserved for scripts/reporting.ts only.
        return this.legacyReportCasing ? LEGACY_REPORT_FAILURE : 'failed';
      case 'CHARGEBACK':
        return 'chargeback';
      default:
        return null;
    }
  }
}
