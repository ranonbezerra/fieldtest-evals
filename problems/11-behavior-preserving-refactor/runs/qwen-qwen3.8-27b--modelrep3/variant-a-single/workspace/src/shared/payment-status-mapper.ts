/**
 * Single source of truth for provider-status -> internal-status mapping.
 *
 * This logic previously existed in three independent copies:
 *   - src/orders/orders.status.ts   (order detail screen)
 *   - src/payouts/payouts.status.ts (payout reconciliation)
 *   - scripts/reporting.ts          (nightly finance CSV)
 *
 * The mapper owns the union of provider codes any of those consumers can
 * receive. The consumers' historical quirks are preserved, not unified:
 *   - unknown codes behave differently per consumer (`onUnknown`) — see NOTES.md
 *   - the nightly CSV upper-cases the failure statuses (`legacyReportCasing`)
 */

/** Internal statuses shared by every consumer. */
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/**
 * Everything `map()` can return under any configuration.
 * 'unknown' is the payout-reconciliation sentinel for unknown codes;
 * 'FAILED' is the nightly-CSV legacy spelling of the failure status.
 */
export type MappedPaymentStatus = PaymentStatus | 'unknown' | 'FAILED';

export interface PaymentStatusMapperOptions {
  /**
   * What to do with a provider code that is not in the table.
   * The three consumers deliberately differ (see NOTES.md) — do not unify:
   *   'throw'   orders: throw `unknown provider status: <code>` (the default)
   *   'unknown' payouts: return the 'unknown' sentinel so reconciliation
   *              keeps running
   *   'null'    reporting: return null so the caller can skip the row
   */
  onUnknown?: 'throw' | 'unknown' | 'null';

  /**
   * Nightly-CSV quirk, preserved on purpose: emit 'FAILED' instead of
   * 'failed' for the failure statuses. Finance's spreadsheet filters on the
   * upper-cased value in the status column (consumed since 2021). Only the
   * reporting call site sets this.
   */
  legacyReportCasing?: boolean;
}

/**
 * Union of every provider code any consumer can receive.
 * `PAYOUT_SETTLED` / `PAYOUT_REVERSED` are sent only by the payout
 * integration; the shared table knows them so the payouts side is lossless.
 */
const STATUS_BY_PROVIDER_CODE: Record<string, PaymentStatus | undefined> = {
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

export class PaymentStatusMapper {
  constructor(private readonly options: PaymentStatusMapperOptions = {}) {}

  /**
   * Maps one provider status code using this mapper's configuration.
   *
   *   known code, no legacyReportCasing    -> PaymentStatus
   *   known failure code, legacyReportCasing -> 'FAILED'
   *   unknown code, onUnknown 'throw'      -> throws
   *   unknown code, onUnknown 'unknown'    -> 'unknown'
   *   unknown code, onUnknown 'null'       -> null
   */
  map(code: string): MappedPaymentStatus | null {
    const status = STATUS_BY_PROVIDER_CODE[code];
    if (status === undefined) {
      const onUnknown = this.options.onUnknown ?? 'throw';
      if (onUnknown === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      if (onUnknown === 'unknown') {
        return 'unknown';
      }
      return null;
    }
    if (status === 'failed' && this.options.legacyReportCasing) {
      return 'FAILED';
    }
    return status;
  }
}
