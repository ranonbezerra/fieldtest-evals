// The single provider-status -> internal-status mapping for the platform.
//
// This table used to be copy-pasted in three places (orders, payouts, the
// nightly reporting script) and the copies had drifted. All three call
// sites now delegate here. The history of the copies, the reporting casing
// quirk, and the deliberate unknown-code divergences are documented in
// NOTES.md.

export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/**
 * How `map` treats a provider code that is not in the table.
 *
 * The three call sites deliberately disagree here, and the divergence is
 * preserved rather than unified (see NOTES.md):
 *
 *   - orders:    'throw'   the order detail screen cannot render an unverified status
 *   - payouts:    'unknown' a reconciliation run must not stop on an unseen code
 *   - reporting:  'null'    the nightly CSV silently drops rows it does not understand
 */
export type UnknownStatusPolicy = 'throw' | 'unknown' | 'null';

export interface PaymentStatusMapOptions {
  /**
   * Policy for provider codes not in the table. Each call site passes the
   * policy that matches its existing contract. Defaults to 'throw'.
   */
  onUnknown?: UnknownStatusPolicy;

  /**
   * When true, the 'failed' result is returned as 'FAILED' (upper-cased).
   *
   * Not a bug to fix: the nightly finance CSV has emitted 'FAILED' for
   * DECLINED and EXPIRED since 2021, and the finance team's spreadsheets
   * filter on that exact casing. Only the reporting call site passes this
   * option. It is not the default and it must not be normalised away —
   * see NOTES.md before touching it.
   */
  legacyReportCasing?: boolean;
}

/**
 * Everything `map` can return: a canonical status, the legacy 'FAILED'
 * casing, the payouts sentinel 'unknown', or null (reporting's skip).
 */
export type MappedPaymentStatus = PaymentStatus | 'FAILED' | 'unknown' | null;

export class PaymentStatusMapper {
  map(code: string, options: PaymentStatusMapOptions = {}): MappedPaymentStatus {
    const status = this.canonical(code);
    if (status === null) {
      return this.unknown(code, options);
    }
    // The reporting quirk, kept on purpose (see NOTES.md): the finance CSV
    // has upper-cased the failed status since 2021 and its consumers depend
    // on it. Applied only when the call site opts in.
    if (status === 'failed' && options.legacyReportCasing) {
      return 'FAILED';
    }
    return status;
  }

  /**
   * The union of provider codes known to any call site: the base mapping
   * plus the two payout-only codes (PAYOUT_SETTLED, PAYOUT_REVERSED).
   * This is the only mapping table in the repo.
   */
  private canonical(code: string): PaymentStatus | null {
    switch (code) {
      case 'PENDING':
      case 'AWAITING_PAYMENT':
        return 'pending';
      case 'AUTHORIZED':
        return 'authorized';
      case 'CAPTURED':
      case 'SETTLED':
      // Payout-only code, in the table on purpose (union) — see NOTES.md.
      case 'PAYOUT_SETTLED':
        return 'paid';
      case 'REFUNDED':
      case 'PARTIAL_REFUND':
      // Payout-only code, in the table on purpose (union) — see NOTES.md.
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

  /**
   * Unknown-code policies, preserved verbatim from the three copies.
   * Do not unify them — see NOTES.md for what must be checked first.
   */
  private unknown(code: string, options: PaymentStatusMapOptions): MappedPaymentStatus {
    switch (options.onUnknown ?? 'throw') {
      case 'throw':
        // Message kept verbatim from the original orders copy.
        throw new Error(`unknown provider status: ${code}`);
      case 'unknown':
        // Sentinel kept from the original payouts copy: reconciliation
        // must not stop on a code it has not seen yet.
        return 'unknown';
      case 'null':
        // Kept from the original reporting copy: the CSV skips unknown rows.
        return null;
    }
  }
}

/** The mapper is stateless; call sites share one instance. */
export const paymentStatusMapper = new PaymentStatusMapper();
