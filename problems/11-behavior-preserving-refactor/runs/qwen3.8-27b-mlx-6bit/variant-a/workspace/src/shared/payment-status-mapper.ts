/**
 * Pure, stateless mapper from raw provider payment-status codes to internal
 * status values.
 *
 * No I/O, no logging, no database access, no NestJS lifecycle hooks.
 * Call sites instantiate this class with the options that match their
 * legacy behaviour.
 */

// Internal status values produced across all three call sites.
export type InternalStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'refunded';

// What the mapper does when it encounters a provider code not in the table.
export type UnknownPolicy = 'throw' | 'fallback' | 'skip';

export interface MapperOptions {
  /** What to do when the provider code is not in the mapping table. */
  unknownPolicy: UnknownPolicy;

  /**
   * Required when `unknownPolicy` is `'fallback'`.
   * Returned verbatim for unknown codes.
   */
  fallbackValue?: InternalStatus;

  /**
   * When `true`, a mapped `'completed'` status is emitted as the literal
   * string `'COMPLETED'`.
   *
   * Preserves a legacy reporting quirk that CSV consumers depend on.
   * No other call site sets this option.
   */
  legacyReportCasing?: boolean;
}

// Union of all provider codes the three call sites recognise today.
const STATUS_TABLE: Readonly<Record<string, InternalStatus>> = {
  pending: 'pending',
  completed: 'completed',
  failed: 'failed',
  refunded: 'refunded',
  // Payouts-specific codes (present only in the payouts flow).
  payout_initiated: 'pending',
  payout_settled: 'completed',
};

export class PaymentStatusMapper {
  private readonly options: MapperOptions;

  constructor(options: MapperOptions) {
    if (options.unknownPolicy === 'fallback' && options.fallbackValue === undefined) {
      throw new Error('fallbackValue required');
    }
    this.options = options;
  }

  /**
   * Map a raw provider status code to the internal status.
   *
   * - `unknownPolicy: 'throw'`    → throws `TypeError` for unknown codes.
   * - `unknownPolicy: 'fallback'` → returns `options.fallbackValue`.
   * - `unknownPolicy: 'skip'`     → returns `undefined` for unknown codes.
   *
   * `legacyReportCasing`: when `true`, a result of `'completed'` is returned
   * as the literal string `'COMPLETED'`.
   *
   * @returns The internal status, `undefined` (skip), or the fallback value.
   */
  // ASSUMPTION: plan signature is `InternalStatus | undefined`, but the
  // legacyReportCasing quirk produces 'COMPLETED' which is outside that union.
  // Widening to `string | undefined` is the only type-correct option under
  // strict TypeScript.
  map(providerCode: string): string | undefined {
    const mapped = STATUS_TABLE[providerCode];

    if (mapped === undefined) {
      switch (this.options.unknownPolicy) {
        case 'throw':
          throw new TypeError(`Unknown provider status code: ${providerCode}`);
        case 'fallback':
          return this.options.fallbackValue as string;
        case 'skip':
          return undefined;
      }
    }

    if (this.options.legacyReportCasing && mapped === 'completed') {
      return 'COMPLETED';
    }

    return mapped;
  }
}
