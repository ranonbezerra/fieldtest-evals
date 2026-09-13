# Transcript — 11-behavior-preserving-refactor / variant-a / inclusionai/ling-3.0-flash

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me analyze the task carefully.

The task is to:
1. Extract a single `PaymentStatusMapper` into `src/shared/`, covering the union of provider codes; the three call sites delegate to it.
2. The reporting quirk (upper-casing 'FAILED' differently) is preserved via an explicit option on the mapper (e.g., `{ legacyReportCasing: true }`), used only by the reporting call site, documented in code.
3. Before moving anything: write characterization tests for the reporting copy first, pinning its current output for all statuses (including the quirk).
4. Unknown provider codes: preserve each call site's current behavior via the mapper's API; document the divergence in NOTES.md — do NOT unify it.

Let me understand the three current mappings:

**Orders** (`src/orders/orders.status.ts`):
- Returns `OrderStatus` type (never returns null)
- Throws on unknown codes
- Returns `'failed'` for DECLINED/EXPIRED

**Payouts** (`src/payouts/payouts.status.ts`):
- Returns `PayoutStatus` type (includes 'unknown')
- Returns `'unknown'` on unknown codes
- Has extra codes: PAYOUT_SETTLED, PAYOUT_REVERSED

**Reporting** (`scripts/reporting.ts`):
- Returns `string | null`
- Returns `null` on unknown codes (silent skip)
- Returns `'FAILED'` (uppercase) for DECLINED/EXPIRED — the quirk

So I need to create a unified mapper that can handle all these cases with options/configuration for the different behaviors.

Let me design the `PaymentStatusMapper`:

```ts
// src/shared/payment-status-mapper.ts

export type InternalStatus = 
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown'
  | null;

export interface MapperOptions {
  legacyReportCasing?: boolean;
}

export function mapProviderStatus(code: string, options?: MapperOptions): InternalStatus {
  // ...
}
```

Wait, let me think about the return types more carefully.

Orders returns `OrderStatus` (no null, throws on unknown).
Payouts returns `PayoutStatus` (includes 'unknown', never null).
Reporting returns `string | null` (null on unknown).

The mapper needs to be flexible enough. Let me think about the API.

Option 1: The mapper has options that change behavior:
- `{ throwOnUnknown: true }` → throws (orders behavior)
- `{ resolveUnknownTo: 'unknown' }` or similar → returns 'unknown' (payouts behavior)  
- Default → returns null (reporting behavior)
- `{ legacyReportCasing: true }` → returns 'FAILED' for DECLINED/EXPIRED

Let me design this more carefully:

```ts
export interface MapperOptions {
  // When true, unmapped provider codes throw instead of returning null/unknown
  throwOnUnknown?: boolean;
  // When true, returns 'unknown' for unmapped codes instead of null
  resolveUnknown?: boolean;
  // When true, uses the legacy report casing (uppercase FAILED) for DECLINED/EXPIRED
  legacyReportCasing?: boolean;
}
```

Actually, let me reconsider. The three behaviors for unknown codes are:
1. Orders: throw
2. Payouts: return 'unknown'
3. Reporting: return null (skip silently)

And the quirk is:
- Reporting: returns 'FAILED' instead of 'failed' for DECLINED/EXPIRED

Let me design the mapper API to support all three through options:

```ts
export interface MapperOptions {
  // Action to take when a provider code is not recognized
  onUnknown?: 'throw' | 'unknown' | 'null';  // default: 'null'
  // Legacy report casing: uppercase FAILED for declined/expired
  legacyReportCasing?: boolean;
}
```

Hmm, but the issue says "preserve each call site's current behavior via the mapper's API". Let me think about how to make this clean.

Actually, let me reconsider the design. A cleaner approach:

The core mapping is a table/switch that maps provider codes to internal statuses (lowercase). Then options modify behavior:

```ts
export interface MapperOptions {
  // If true, unmapped codes throw (orders behavior). Default: false.
  throwOnUnknown?: boolean;
  // If true, unmapped codes return 'unknown' (payouts behavior). Default: false.
  // Note: cannot be used simultaneously with throwOnUnknown.
  resolveUnknown?: boolean;
  // If true, DECLINED/EXPIRED map to 'FAILED' instead of 'failed' (reporting quirk).
  legacyReportCasing?: boolean;
}
```

The default behavior (no options) returns null for unknown codes (reporting default).

Let me now build the full solution.

Let me list all provider codes across all three:
- PENDING, AWAITING_PAYMENT → pending
- AUTHORIZED → authorized
- CAPTURED, SETTLED → paid
- PAYOUT_SETTLED → paid (payouts only)
- REFUNDED, PARTIAL_REFUND → refunded
- PAYOUT_REVERSED → refunded (payouts only)
- DECLINED, EXPIRED → failed (or FAILED with quirk)
- CHARGEBACK → chargeback
- Anything else → depends on call site

Now let me create the files:

1. `src/shared/payment-status-mapper.ts` - the unified mapper
2. `src/shared/index.ts` or similar - exports
3. `src/orders/orders.status.ts` - refactored to delegate
4. `src/payouts/payouts.status.ts` - refactored to delegate
5. `scripts/reporting.ts` - refactored to delegate
6. `test/reporting.status.spec.ts` - characterization tests (NEW)
7. `NOTES.md` - documentation

Wait, but the instruction says "Before moving anything: the orders and payouts copies have partial tests; the reporting copy has none. Write characterization tests for the reporting copy first". And "Nothing else moves. The pre-existing tests pass unmodified."

So the pre-existing test files (`test/orders.status.spec.ts` and `test/payouts.status.spec.ts`) should still pass. They import from `../src/orders/orders.status.js` and `../src/payouts/payouts.status.js` respectively.

The orders and payouts `mapProviderStatus` functions need to maintain their exact signatures and behaviors. So the refactor needs to keep those as wrappers.

Let me also check: do orders and payouts need to be modified to use the shared mapper? Yes, "all three call sites delegate to it."

Let me design the shared mapper:

```ts
// src/shared/payment-status-mapper.ts

/**
 * Internal status values used across the platform.
 */
export type InternalStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown'
  | null;

export interface MapperOptions {
  /**
   * When true, provider codes not in the mapping table cause a throw.
   * Used by the orders module, which treats unmapped codes as fatal.
   */
  throwOnUnknown?: boolean;
  /**
   * When true, provider codes not in the mapping table resolve to 'unknown'.
   * Used by the payouts module, which must tolerate new provider codes.
   */
  resolveUnknown?: boolean;
  /**
   * When true, DECLINED and EXPIRED map to 'FAILED' (uppercase) instead of
   * 'failed'. This is a legacy quirk that finance CSV consumers depend on.
   * Only used by the reporting script.
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

Now the wrappers:

```ts
// src/orders/orders.status.ts
import { mapProviderStatus } from '../shared/payment-status-mapper.js';
import type { OrderStatus } from './orders.types.js'; // wait, OrderStatus is defined here

// Actually let me check... OrderStatus is defined in this file. Let me keep it.
```

Wait, looking at the original orders.status.ts, it has both the type and the function. Let me keep the type here but delegate the function:

```ts
// src/orders/orders.status.ts
// Provider status -> internal status, for the order detail screen.
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

import { mapProviderStatus } from '../shared/payment-status-mapper.js';

export function mapProviderStatus(code: string): OrderStatus {
  return mapProviderStatus(code, { throwOnUnknown: true }) as OrderStatus;
}
```

```ts
// src/payouts/payouts.status.ts
// Provider status -> internal status, for payout reconciliation.
// Same provider, two extra codes this side of the integration can receive.
export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

import { mapProviderStatus } from '../shared/payment-status-mapper.js';

export function mapProviderStatus(code: string): PayoutStatus {
  return mapProviderStatus(code, { resolveUnknown: true }) as PayoutStatus;
}
```

```ts
// scripts/reporting.ts
import { mapProviderStatus } from '../src/shared/payment-status-mapper.js';

export function mapProviderStatus(code: string): string | null {
  return mapProviderStatus(code, { legacyReportCasing: true });
}
```

Wait, but there's a circular import issue for reporting.ts. It imports from `../src/shared/...` but it's in `scripts/`. The path should be `../src/shared/payment-status-mapper.js`. Let me check the file structure... `scripts/reporting.ts` is at the root, and `src/shared/` is under `src/`. So `../src/shared/payment-status-mapper.js` is correct... wait, no. If reporting.ts is at `scripts/reporting.ts` and shared is at `src/shared/payment-status-mapper.ts`, then from `scripts/reporting.ts` the path would be `../src/shared/payment-status-mapper.js`. Yes, that's correct.

Now for the characterization tests for the reporting copy:

```ts
// test/reporting.status.spec.ts
import { describe, expect, it } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping', () => {
  it('maps pending codes', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps paid codes', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund codes', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps declined and expired to FAILED (legacy casing quirk)', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown codes', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
  });
});
```

Now for NOTES.md:

```markdown
# Payment Status Mapping — Notes

## Three call sites (now one source of truth)

The provider status → internal status mapping used to exist in three places:

- `src/orders/orders.status.ts` — for the order detail screen
- `src/payouts/payouts.status.ts` — for payout reconciliation
- `scripts/reporting.ts` — for the nightly CSV export

All three now delegate to `src/shared/payment-status-mapper.ts`.

## The reporting quirk

The reporting script returns `'FAILED'` (uppercase) for `DECLINED` and `EXPIRED`,
while the other two call sites return `'failed'` (lowercase). Finance CSV
consumers depend on this casing. The `{ legacyReportCasing: true }` option on
the mapper preserves it; only the reporting call site uses it.

## Deliberate divergence on unknown provider codes

Each call site handles an unrecognized provider code differently:

- **Orders** — throws (`throwOnUnknown: true`)
- **Payouts** — returns `'unknown'` (`resolveUnknown: true`)
- **Reporting** — returns `null` (default)

This divergence is intentional. Each caller has a different contract with its
downstream consumer. Before anyone unifies these:

1. All three downstream consumers must agree on a single contract.
2. The order detail screen, payout reconciliation, and finance CSV pipeline
   must all be updated in the same release.
3. A migration/backfill plan must exist for any data that was silently skipped,
   thrown on, or marked as 'unknown'.
```

Now let me also think about the `src/shared/` directory. I should probably create an index or at least make sure the module is properly exported.

Let me also think about whether there should be a `src/shared/shared.module.ts` or similar. The task mentions NestJS but this is a simple utility, so maybe not needed. The task says "Deliver every file the solution needs." A simple export file should suffice.

Actually, let me reconsider the reporting.ts import path. In the original:
```ts
// scripts/reporting.ts
```
And the tsconfig includes `src/**/*.ts`, `scripts/**/*.ts`, `test/**/*.ts`. So importing from `../src/shared/...` is fine.

Wait, let me also double-check: does `scripts/reporting.ts` import from `../src/shared/payment-status-mapper.js`? The reporting file is at `scripts/reporting.ts`. One level up is the workspace root, then `src/shared/...`. So `../src/shared/payment-status-mapper.js` is correct. Yes.

Let me also make sure the build works. Let me think about potential issues:

1. The `src/orders/orders.status.ts` needs to import from `../shared/payment-status-mapper.js`. The orders file is at `src/orders/orders.status.ts`, so `../shared/...` goes to `src/shared/...`. Correct.

2. The `src/payouts/payouts.status.ts` needs to import from `../shared/payment-status-mapper.js`. Payouts is at `src/payouts/payouts.status.ts`, so `../shared/...` goes to `src/shared/...`. Correct.

3. The test files import from `../src/orders/orders.status.js` and `../src/payouts/payouts.status.js` — these are unchanged.

4. The new test file imports from `../scripts/reporting.js`. Test is at `test/reporting.status.spec.ts`, so `../scripts/reporting.js` is correct.

Now let me think about edge cases in the mapper. The `STATUS_TABLE` maps to `InternalStatus` values. `'FAILED'` is NOT in the table (it's a quirk output). When `legacyReportCasing` is true, we check the quirk AFTER looking up the code in the table. Since DECLINED and EXPIRED are in the table as `'failed'`, we find them, then apply the quirk to return `'FAILED'`. Good.

Wait, but what about the `resolveUnknown` option? If `resolveUnknown` is true and we get an unknown code, we return `'unknown'`. But what if `throwOnUnknown` is also true? Let me add a check or document that these are mutually exclusive.

Actually, looking at my code:
```ts
if (mapped === undefined) {
    if (options.throwOnUnknown) {
      throw new Error(...);
    }
    if (options.resolveUnknown) {
      return 'unknown';
    }
    return null;
  }
```

The throw check comes first, so if both are set, it throws. That's probably fine as a defensive measure. Let me add a comment about it.

Let me finalize all the files and make sure the pre-existing tests still pass. The pre-existing tests import the local `mapProviderStatus` functions which now delegate to the shared mapper. Let's verify:

**Orders test** (`test/orders.status.spec.ts`):
- `mapProviderStatus('CAPTURED')` → should return `'paid'` ✓ (table has CAPTURED → 'paid')
- `mapProviderStatus('SETTLED')` → `'paid'` ✓
- `mapProviderStatus('REFUNDED')` → `'refunded'` ✓
- `mapProviderStatus('PARTIAL_REFUND')` → `'refunded'` ✓
- `mapProviderStatus('WHATEVER')` → should throw ✓ (throwOnUnknown: true)

**Payouts test** (`test/payouts.status.spec.ts`):
- `mapProviderStatus('PAYOUT_SETTLED')` → `'paid'` ✓ (table has PAYOUT_SETTLED → 'paid')
- `mapProviderStatus('PAYOUT_REVERSED')` → `'refunded'` ✓ (table has PAYOUT_REVERSED → 'refunded')

All good.

Now let me also think about whether the reporting tests need to import from the reporting module's `mapProviderStatus` function. Looking at the original reporting.ts, it exports `mapProviderStatus` directly. After refactoring, it still exports a function with the same name. The characterization test should import from `../scripts/reporting.js`. Good.

Actually wait - should the characterization tests import from the reporting script's `mapProviderStatus` (which is now a thin wrapper) or directly from the shared mapper with options? The task says "Write characterization tests for the reporting copy first, pinning its current output for all statuses." This means testing the reporting copy's behavior, i.e., `scripts/reporting.ts`'s `mapProviderStatus`. So importing from `../scripts/reporting.js` is correct.

Let me also check if there's a `src/shared/` directory that needs to be created. Yes, it doesn't exist yet. I'll create the file there.

One more thing: should I create a `src/shared/index.ts`? Not strictly necessary for a single export, but it might be cleaner. Given the instruction "Do exactly what the task asks" and "Do not create a file it does not call for", I'll skip it unless needed. The direct import path works fine.

Let me write out all the final files now.

Hmm, one thing I want to double check: in the reporting.ts, the original import structure has the `mapProviderStatus` function at module level, and `buildRows` uses it. After my refactor, `mapProviderStatus` in reporting.ts delegates to the shared mapper. The `buildRows` function doesn't need changes since it just calls `mapProviderStatus`.

Let me also think about the file structure for imports more carefully:

Original `scripts/reporting.ts` - it currently has NO imports from `src/`. After refactor, it imports from `../src/shared/payment-status-mapper.js`. This is fine since tsconfig includes both `src/**/*.ts` and `scripts/**/*.ts`.

Let me finalize everything.

One more consideration: the `src/orders/orders.service.ts` imports from `./orders.status.js`:
```ts
import { mapProviderStatus, type OrderStatus } from './orders.status.js';
```

After my refactor, `orders.status.ts` still exports both `mapProviderStatus` and `OrderStatus`, so this import still works. ✓

Similarly for `src/payouts/payouts.service.ts`:
```ts
import { mapProviderStatus, type PayoutStatus } from './payouts.status.js';
```

Still works. ✓

Now let me think about whether there could be any type issues. The orders `mapProviderStatus` returns `OrderStatus` and casts from the shared mapper's return. Since `throwOnUnknown: true` means it never returns null or 'unknown' for valid codes, and valid codes map to `OrderStatus` members, the cast is safe. Same for payouts with `resolveUnknown: true`.

I think the solution is complete. Let me write it all out.

Actually, let me reconsider one thing. The `mapProviderStatus` function name in the shared module is the same as in each module. There's no shadowing issue since they're in different modules. Each local module's `mapProviderStatus` shadows the imported one only within that module's scope. This is fine.

Let me write the final solution.

Wait, also: for the shared mapper file, let me make sure the type exports and function are properly accessible. Let me structure it cleanly.

I also need to think about whether to include a `src/shared/index.ts`. Looking at the imports:
- `src/orders/orders.status.ts` imports from `'../shared/payment-status-mapper.js'`
- `src/payouts/payouts.status.ts` imports from `'../shared/payment-status-mapper.js'`
- `scripts/reporting.ts` imports from `'../src/shared/payment-status-mapper.js'`

All direct imports, no index needed. Good.

Let me now write the complete solution.
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

### src/orders/orders.status.ts
```ts
// Provider status -> internal status, for the order detail screen.
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

export function mapProviderStatus(code: string): OrderStatus {
  // throwOnUnknown: the order detail screen treats unmapped codes as fatal.
  return sharedMapProviderStatus(code, { throwOnUnknown: true }) as OrderStatus;
}
```

### src/payouts/payouts.status.ts
```ts
// Provider status -> internal status, for payout reconciliation.
// Same provider, two extra codes this side of the integration can receive.
export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

export function mapProviderStatus(code: string): PayoutStatus {
  // resolveUnknown: reconciliation must not stop on a code we have not seen yet.
  return sharedMapProviderStatus(code, { resolveUnknown: true }) as PayoutStatus;
}
```

### scripts/reporting.ts
```ts
// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.

import { mapProviderStatus as sharedMapProviderStatus } from '../src/shared/payment-status-mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

export function mapProviderStatus(code: string): string | null {
  // legacyReportCasing: finance's sheet filters on the upper-cased value in
  // this column — a quirk their CSV consumers depend on since 2021.
  return sharedMapProviderStatus(code, { legacyReportCasing: true });
}

export function buildRows(
  payments: Array<{ reference: string; providerStatus: string; amountMinor: number }>,
): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const p of payments) {
    const status = mapProviderStatus(p.providerStatus);
    if (status === null) {
      continue;
    }
    rows.push({ reference: p.reference, status, amountMinor: p.amountMinor });
  }
  return rows;
}
```

### test/reporting.status.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping', () => {
  it('maps the pending codes', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps the settled codes to paid', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps both refund codes to refunded', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps declined and expired to FAILED (legacy casing quirk)', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for an unknown code (silent skip)', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
  });
});
```

### NOTES.md
```markdown
# Payment Status Mapping — Notes

## Three call sites (now one source of truth)

The provider status → internal status mapping used to exist in three places:

- `src/orders/orders.status.ts` — for the order detail screen
- `src/payouts/payouts.status.ts` — for payout reconciliation
- `scripts/reporting.ts` — for the nightly CSV export

All three now delegate to `src/shared/payment-status-mapper.ts`.

## The reporting quirk

The reporting script returns `'FAILED'` (uppercase) for `DECLINED` and `EXPIRED`,
while the other two call sites return `'failed'` (lowercase). Finance CSV
consumers depend on this casing. The `{ legacyReportCasing: true }` option on
the mapper preserves it; only the reporting call site uses it.

## Deliberate divergence on unknown provider codes

Each call site handles an unrecognized provider code differently:

- **Orders** — throws (`throwOnUnknown: true`)
- **Payouts** — returns `'unknown'` (`resolveUnknown: true`)
- **Reporting** — returns `null` (default behaviour)

This divergence is intentional. Each caller has a different contract with its
downstream consumer. Before anyone unifies these:

1. All three downstream consumers must agree on a single contract.
2. The order detail screen, payout reconciliation, and finance CSV pipeline
   must all be updated in the same release.
3. A migration/backfill plan must exist for any data that was silently skipped,
   thrown on, or marked as `'unknown'`.
```
```


---

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


---
