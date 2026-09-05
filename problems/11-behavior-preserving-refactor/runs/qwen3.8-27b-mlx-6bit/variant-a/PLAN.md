## 1. Assumptions

| Decision | Choice | Why |
|---|---|---|
| Mapper location & file | `src/shared/payment-status-mapper.ts`, plain class (no Nest module) | Stateless; services instantiate it in their constructor. Avoids module wiring for a pure function. |
| Reporting service path | `src/reporting/reporting.service.ts` inside `ReportingModule` | Follows the `<feature>` layout already used by orders and payouts. |
| Internal status values | `type InternalStatus = 'pending' \| 'completed' \| 'failed' \| 'refunded'` | Union of all statuses the three call sites produce today. |
| Reporting quirk detail | When `legacyReportCasing` is true, the `'completed'` status is emitted as the literal string `'COMPLETED'`; all other statuses remain lowercase. | The problem states "upper-cases one status differently"; this is the single divergence to pin. |
| Payouts extra codes | Two provider codes (`'payout_initiated'`, `'payout_settled'`) map to `'pending'` and `'completed'` respectively. They exist only in the payouts flow but are part of the union table. | The mapper covers the union; no call-site special-casing needed. |
| Unknown-policy enum values | `'throw' \| 'fallback' \| 'skip'` with optional `fallbackValue: InternalStatus` | Covers the three observed behaviors without overloading one parameter. |
| NOTES.md location | Repository root (`NOTES.md`) | Conventional place for developer-facing refactor notes. |
| Existing test files | Untouched; they pass unmodified by virtue of behavior preservation. | The task requires this explicitly. |

## 2. Data model

none — this is a pure in-memory mapping refactor; no schema or persistence change.

## 3. Types and signatures

```ts
// ---- src/shared/payment-status-mapper.ts ----

export type InternalStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'refunded';

export type UnknownPolicy = 'throw' | 'fallback' | 'skip';

export interface MapperOptions {
  /** What to do when the provider code is not in the mapping table. */
  unknownPolicy: UnknownPolicy;
  /** Required when unknownPolicy === 'fallback'. Returned for unknown codes. */
  fallbackValue?: InternalStatus;
  /**
   * When true, the 'completed' status is emitted as 'COMPLETED' (uppercase).
   * Preserves a legacy reporting quirk; no other call site sets this.
   */
  legacyReportCasing?: boolean;
}

export class PaymentStatusMapper {
  constructor(options: MapperOptions);

  /**
   * Map a raw provider status code to the internal status.
   *
   * - unknownPolicy 'throw'  → throws TypeError for unknown codes
   * - unknownPolicy 'fallback' → returns options.fallbackValue
   * - unknownPolicy 'skip'   → returns undefined for unknown codes
   *
   * legacyReportCasing: when true, 'completed' is returned as 'COMPLETED'.
   *
   * @returns InternalStatus | undefined (undefined only for 'skip')
   */
  map(providerCode: string): InternalStatus | undefined;
}
```

**Errors raised:**

| Error | Raised by | Condition |
|---|---|---|
| `TypeError` | `PaymentStatusMapper.map` | `unknownPolicy === 'throw'` and code not in table |
| `Error('fallbackValue required')` | `PaymentStatusMapper` constructor | `unknownPolicy === 'fallback'` and `fallbackValue` is absent |

**Ordering rule:** Characterization tests for the reporting call site must exist and pass *before* any production code is modified. The extraction is then verified against those same tests.

## 4. Control flow

No state machine, no transactions. The refactor is a read-only mapping.

**Before (three copies):**
1. Orders service calls a local private method `mapStatus(code)` → always throws on unknown.
2. Payouts service calls a local private method `mapStatus(code)` → returns `'unknown'` on unknown.
3. Reporting service calls a local private method `mapStatus(code)` → skips (omits from array) on unknown; upper-cases `'completed'` to `'COMPLETED'`.

**After (delegation):**
1. Orders service instantiates `new PaymentStatusMapper({ unknownPolicy: 'throw' })` and calls `.map(code)`.
2. Payouts service instantiates `new PaymentStatusMapper({ unknownPolicy: 'fallback', fallbackValue: 'refunded' })` and calls `.map(code)`.
   *(Note: the payouts fallback value is whatever string the existing code returns for unknown — the implementer reads the fixture to confirm; listed here as `'refunded'` as a placeholder matching the "return 'unknown'" description. If the fixture shows a different literal, use that.)*
3. Reporting service instantiates `new PaymentStatusMapper({ unknownPolicy: 'skip', legacyReportCasing: true })` and calls `.map(code)`, filtering out `undefined` results before writing to the CSV.

**What must not be inside the mapper:** I/O, logging, database access, any NestJS lifecycle hook. It is a pure, synchronous, stateless class.

## 5. Tests

| Test (file `test/reporting.spec.ts`) | Proves |
|---|---|
| maps `'pending'` → `'pending'` | Reporting preserves the base pending mapping. |
| maps `'completed'` → `'COMPLETED'` | The legacy upper-case quirk is preserved. |
| maps `'failed'` → `'failed'` | Reporting preserves the base failed mapping. |
| maps `'refunded'` → `'refunded'` | Reporting preserves the base refunded mapping. |
| maps an unknown code (e.g. `'zzz'`) → returns nothing / skips | Reporting silently drops unknown codes from output. |
| maps `'payout_initiated'` → `'pending'` (if reporting encounters it) | Union table covers payout-specific codes without error. |

*All pre-existing tests in `test/orders.spec.ts` and `test/payouts.spec.ts` pass unmodified, proving the extraction preserved their behavior.*

## 6. Manifest

<!-- manifest
src/shared/payment-status-mapper.ts | reads: - | PaymentStatusMapper class, InternalStatus type, UnknownPolicy type, MapperOptions interface
test/reporting.spec.ts | reads: src/shared/payment-status-mapper.ts | Characterization tests pinning reporting output for all statuses including the legacyReportCasing quirk and skip-on-unknown
src/reporting/reporting.service.ts | reads: src/shared/payment-status-mapper.ts | Reporting service refactored to delegate status mapping to PaymentStatusMapper with legacyReportCasing and skip policy
src/orders/orders.service.ts | reads: src/shared/payment-status-mapper.ts | Orders service refactored to delegate status mapping to PaymentStatusMapper with throw policy
src/payouts/payouts.service.ts | reads: src/shared/payment-status-mapper.ts | Payouts service refactored to delegate status mapping to PaymentStatusMapper with fallback policy
NOTES.md | reads: src/shared/payment-status-mapper.ts | Documents the three divergent unknown-code behaviors and the legacyReportCasing quirk
-->
