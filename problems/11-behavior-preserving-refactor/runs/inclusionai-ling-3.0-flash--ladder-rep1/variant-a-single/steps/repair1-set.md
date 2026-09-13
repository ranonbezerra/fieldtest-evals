# repair1-set

## reasoning

```
The error is that `'FAILED'` is not assignable to `InternalStatus` because `InternalStatus` only has `'failed'` (lowercase), not `'FAILED'`.

The mapper's `legacyReportCasing` option returns `'FAILED'` (uppercase) for DECLINED and EXPIRED statuses. But `InternalStatus` doesn't include `'FAILED'`.

Looking at the reference material, the `legacyReportCasing` option is documented as returning `'FAILED'` (uppercase) — this is the explicit quirk. So the `InternalStatus` type needs to include `'FAILED'` as a valid value.

The fix is to add `'FAILED'` to the `InternalStatus` union type.

Let me just fix this one file.
```

## reply

### src/shared/payment-status-mapper.ts
```ts
// Provider status -> internal status, unified mapping table.
// All call sites delegate here; see NOTES.md for per-site behaviour notes.

export type InternalStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown'
  | 'FAILED'
  | null;

export interface MapperOptions {
  /**
   * When true, a provider code not present in the mapping table causes a throw.
   * Used by the orders module — the order detail screen treats unmapped codes
   * as a fatal integration problem.
   */
  throwOnUnknown?: boolean;
  /**
   * When true, a provider code not present in the mapping table resolves to
   * the literal 'unknown'.
   * Used by the payouts module — reconciliation must tolerate new provider
   * codes without crashing.
   */
  resolveUnknown?: boolean;
  /**
   * When true, DECLINED and EXPIRED map to 'FAILED' (uppercase) instead of
   * 'failed' (lowercase).
   * This is a legacy quirk that the finance CSV consumers depend on.
   * Only the reporting call site uses it. Do not make this the default.
   */
  legacyReportCasing?: boolean;
}

const STATUS_TABLE: Record<string, InternalStatus> = {
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

export function mapProviderStatus(
  code: string,
  options: MapperOptions = {},
): InternalStatus {
  const mapped = STATUS_TABLE[code];

  if (mapped === undefined) {
    if (options.throwOnUnknown) {
      throw new Error(`unknown provider status: ${code}`);
    }
    if (options.resolveUnknown) {
      return 'unknown';
    }
    return null;
  }

  if (options.legacyReportCasing && (code === 'DECLINED' || code === 'EXPIRED')) {
    return 'FAILED';
  }

  return mapped;
}
```
