import { ApiException } from './api-exception.js';

/**
 * Single source of truth for the provider-status -> internal-status mapping.
 *
 * Extracted from three copies that used to live side by side:
 *   - src/orders/orders.service.ts      (base table)
 *   - src/payouts/payouts.service.ts    (base table + SETTLED + RECALLED)
 *   - scripts/generate-status-report.ts (base table, REVERSED emitted as "VOIDED")
 *
 * The mapper covers the UNION of provider codes known to any of those copies.
 * The behaviors that used to differ between the copies (unknown-code handling,
 * the reporting casing quirk) are preserved through options, not unified.
 * See NOTES.md for the divergence table.
 *
 * This is deliberately not a NestJS provider: the preserved behaviors differ
 * per call site, so each call site constructs its own configured instance.
 */

/** Internal statuses surfaced by the API (orders + payouts views). */
export type InternalPaymentStatus =
  | 'authorized'
  | 'captured'
  | 'pending'
  | 'declined'
  | 'refunded'
  | 'voided'
  | 'settled'
  | 'recalled'
  | 'unknown';

/**
 * Legacy reporting token. The old reporting script emitted "VOIDED"
 * (uppercase) for REVERSED instead of the API's "voided"; downstream CSV
 * consumers depend on the exact uppercase string. Only reachable when
 * `legacyReportCasing` is enabled.
 */
export const LEGACY_REPORT_VOIDED = 'VOIDED' as const;

/** `map()` returns a mapped status, the legacy token, or null (skip mode). */
export type PaymentStatusMapperResult = InternalPaymentStatus | typeof LEGACY_REPORT_VOIDED | null;

/**
 * What to do with a provider code that is not in the union table.
 * Each call site keeps the behavior its original copy had; see NOTES.md.
 */
export type UnknownCodeBehavior = 'throw' | 'unknown' | 'skip';

export interface PaymentStatusMapperOptions {
  /**
   * Per-call-site behavior on unknown codes -- preserved, NOT unified:
   *   - "throw"   -- orders module: throws (surfaced as envelope code
   *                  "unrecognized_provider_status")
   *   - "unknown" -- payouts module: returns the "unknown" sentinel
   *   - "skip"    -- reporting script: returns null; the caller omits the row
   * Defaults to "unknown". All three call sites set it explicitly anyway.
   *
   * ASSUMPTION: the task lists the divergence as (throw / 'unknown' / skip);
   * this is the mapping to (orders / payouts / reporting) in the order the
   * three copies were introduced.
   */
  onUnknown?: UnknownCodeBehavior;

  /**
   * Reporting-only quirk, preserved on purpose: emit the legacy uppercase
   * "VOIDED" token for REVERSED instead of "voided". ONLY the reporting call
   * site sets this; orders and payouts must leave it unset.
   */
  legacyReportCasing?: boolean;
}

// ASSUMPTION: the fixture's exact provider codes and internal tokens are not
// enumerated in the task; this union (base six codes + the two payouts-only
// codes) is the reconstructed fixture per the variant description.
const BASE_PROVIDER_CODES: Record<string, InternalPaymentStatus> = {
  AUTHORIZED: 'authorized',
  CAPTURED: 'captured',
  PENDING: 'pending',
  DECLINED: 'declined',
  REFUNDED: 'refunded',
  REVERSED: 'voided',
};

// Codes only the payouts copy knew before the extraction.
const PAYOUTS_ONLY_PROVIDER_CODES: Record<string, InternalPaymentStatus> = {
  SETTLED: 'settled',
  RECALLED: 'recalled',
};

/** Union of provider codes known to any of the three original copies. */
const PROVIDER_CODE_UNION: Readonly<Record<string, InternalPaymentStatus>> = {
  ...BASE_PROVIDER_CODES,
  ...PAYOUTS_ONLY_PROVIDER_CODES,
};

export class PaymentStatusMapper {
  private readonly onUnknown: UnknownCodeBehavior;
  private readonly legacyReportCasing: boolean;

  constructor(options: PaymentStatusMapperOptions = {}) {
    this.onUnknown = options.onUnknown ?? 'unknown';
    this.legacyReportCasing = options.legacyReportCasing ?? false;
  }

  /**
   * Map one raw provider status. Matches codes exactly, as the original
   * copies did (no trimming, no case folding).
   *
   * Returns null only in "skip" mode, for unknown codes. Returns
   * LEGACY_REPORT_VOIDED only for REVERSED with legacyReportCasing enabled.
   */
  map(providerStatus: string): PaymentStatusMapperResult {
    if (this.legacyReportCasing && providerStatus === 'REVERSED') {
      // ASSUMPTION: the "uppercased differently" status in the legacy
      // reporting copy is REVERSED, emitted as "VOIDED".
      return LEGACY_REPORT_VOIDED;
    }

    const mapped = PROVIDER_CODE_UNION[providerStatus];
    if (mapped !== undefined) {
      return mapped;
    }

    // Per-call-site divergence, preserved and documented in NOTES.md. Do NOT unify.
    if (this.onUnknown === 'throw') {
      throw new ApiException('unrecognized_provider_status', `Unrecognized provider status: ${providerStatus}`, {
        providerStatus,
      });
    }
    if (this.onUnknown === 'skip') {
      return null;
    }
    return 'unknown';
  }
}
