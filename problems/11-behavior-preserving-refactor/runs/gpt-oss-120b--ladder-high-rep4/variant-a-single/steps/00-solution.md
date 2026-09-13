# solution

## reasoning

```
We need to understand the problem fully, then perform modifications accordingly. The repository seems to be a minimal fixture (not a NestJS app). Actually, in this test environment, we have a simple Node/Esm code with TypeScript. The repository has a package.json with test scripts. The files include:

- scripts/reporting.ts: containing mapProviderStatus and buildRows functions for the reporting script.
- src/orders/orders.service.ts: uses mapProviderStatus from src/orders/orders.status.ts.
- src/orders/orders.status.ts: defines OrderStatus and mapProviderStatus function, throwing on unknown codes.
- src/payouts/payouts.service.ts: uses mapProviderStatus from src/payouts/payouts.status.ts.
- src/payouts/payouts.status.ts: defines PayoutStatus and mapProviderStatus function, returning 'unknown' for default case.
- test/orders.status.spec.ts: tests for orders status mapping.
- test/payouts.status.spec.ts: tests for payouts status mapping.

The task: extract a single `PaymentStatusMapper` into `src/shared/`, covering the union of provider codes, and have the three call sites delegate to it.

The call sites:
- Orders: mapProviderStatus used in OrdersService and test. It expects to map provider status to OrderStatus type (string union). It throws on unknown codes.

- Payouts: mapProviderStatus used in PayoutsService.reconcile. It expects to map provider status to PayoutStatus (includes 'unknown' code). It returns 'unknown' for default case.

- Reporting script: mapProviderStatus in scripts/reporting.ts. It maps provider status to string (or null). It includes a quirk: when mapping 'DECLINED' or 'EXPIRED', it returns 'FAILED' (uppercase). In orders and payouts mapping, they map those to 'failed' (lowercase). Also unknown codes: returns null (skip in rows). So this is the third behavior: unknown returns null (skip). Additionally, it returns uppercase 'FAILED' for finance sheet.

Goal:

1. Write characterization tests for reporting copy before moving anything: need to test the behavior of reporting mapProviderStatus function for all statuses and unknown codes.

2. Extract PaymentStatusMapper into src/shared/. The mapper should cover union of provider codes across all three. That includes codes from orders (PENDING, AWAITING_PAYMENT, AUTHORIZED, CAPTURED, SETTLED, REFUNDED, PARTIAL_REFUND, DECLINED, EXPIRED, CHARGEBACK) plus extra from payouts (PAYOUT_SETTLED, PAYOUT_REVERSED). So union of provider codes = all.

Need to preserve behavior differences for unknown codes: orders should throw; payouts returns 'unknown'; reporting returns null.

Thus the mapper should probably have an API that can handle these behaviors via options: e.g., a function `mapProviderStatus(code: string, options?: { unknown?: 'throw'|'returnUnknown'|'returnNull', legacyReportCasing?: boolean })`. Or we could create three exported functions that use the mapper with appropriate options. But per instructions: "extract a single `PaymentStatusMapper` into `src/shared/`, covering the union of provider codes; the three call sites delegate to it." So we need a class (or functions) that encapsulates mapping logic. Perhaps we define a class `PaymentStatusMapper` with methods:

- `mapToOrderStatus(code: string): OrderStatus` (throws on unknown)
- `mapToPayoutStatus(code: string): PayoutStatus` (returns 'unknown' on unknown)
- `mapToReportStatus(code: string, options?: { legacyReportCasing?: boolean }): string | null` (returns null on unknown; default option legacyReportCasing false? but we need to preserve quirk only for reporting call site; we must set option true at reporting site to enable uppercase 'FAILED'.

Alternative: Provide a generic function that returns a status as string (internal status) and then call sites handle unknown behaviors via options. But they need type safety: orders expects return type OrderStatus, payouts expects PayoutStatus, reporting expects string or null. The type system may not fully enforce, but we can design accordingly.

Simplify: Provide a module `src/shared/payment-status-mapper.ts` exporting three functions:

- `mapProviderStatusToOrder(code: string): OrderStatus` (uses underlying mapping logic and throws on unknown).
- `mapProviderStatusToPayout(code: string): PayoutStatus` (returns 'unknown' if unknown).
- `mapProviderStatusToReport(code: string, options?: { legacyReportCasing?: boolean }): string | null` (returns null on unknown; uppercase 'FAILED' if legacyReportCasing true).

However the instructions: "Extract a single `PaymentStatusMapper` into src/shared/, covering the union of provider codes; the three call sites delegate to it."

Could also be a class with static methods.

Better follow naming pattern: "PaymentStatusMapper". It might be a class with methods. For readability, we can export functions as methods.

Define a type alias for internal status: maybe we define a union type `InternalStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback' | 'unknown'` where 'unknown' only used for payouts. For reporting, they want uppercase 'FAILED' optionally. The mapping returns internal status strings (lowercase), and then reporting's legacyReportCasing option will transform `'failed'` to `'FAILED'`. Actually the current reporting mapProviderStatus returns `'FAILED'` (uppercase) for declined/expired. That is the quirk. So we can implement that by checking option.

Thus design:

- Underlying mapping logic: function mapProviderStatusRaw(code: string): {status: InternalStatus, isKnown: boolean}? Actually we need to know if unknown; we can map to undefined for unknown.

Simplify: mapping function returns maybe a string (lowercase internal status) or undefined for unknown. Then wrapper functions handle unknown behavior.

Pseudo:

```ts
export type InternalStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';

export function rawMapProviderStatus(code: string): InternalStatus | undefined {
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
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      return undefined;
  }
}
```

Now:

`export function mapProviderStatusToOrder(code: string): OrderStatus { const status = rawMapProviderStatus(code); if (status === undefined) throw new Error(`unknown provider status: ${code}`); return status as OrderStatus; }`

Define OrderStatus type as before.

`export function mapProviderStatusToPayout(code: string): PayoutStatus { const status = rawMapProviderStatus(code); return status ?? 'unknown' as PayoutStatus; }` Ensure type union includes unknown.

`export function mapProviderStatusToReport(code: string, options?: { legacyReportCasing?: boolean }): string | null { const status = rawMapProviderStatus(code); if (status === undefined) return null; if (options?.legacyReportCasing && status === 'failed') return 'FAILED'; // else return status (lowercase). return status; }`

But note: for reporting copy, the other statuses are same but they return string exactly as they previously did (lowercase). The previous mapping returned `'pending', 'authorized', 'paid', 'refunded', 'FAILED', 'chargeback'`. The 'FAILED' is only uppercase if decline/expired; else they return lower-case for other statuses. So the above works: only transform 'failed' to uppercase when option true.

Now we need to update the three call sites to use this mapper.

- src/orders/orders.status.ts and src/orders/orders.service.ts currently import mapProviderStatus from './orders.status.js'. After extraction, we can delete src/orders/orders.status.ts (or modify it to delegate). However instructions: "Extract a single PaymentStatusMapper into src/shared/, covering the union of provider codes; the three call sites delegate to it." So we must modify the call sites to delegate. Likely we will keep the existing file but adjust to import from shared mapper. It could be left as is with a wrapper function delegating to the mapper. But the requirement says "extract a single PaymentStatusMapper into src/shared/, covering the union of provider codes; the three call sites delegate to it." So call sites should no longer have their own mapping logic; they call the shared mapper. That could be via importing the appropriate function from shared module. The original orders.status file could be removed (since mapping is extracted). However we cannot delete files unless we modify them to be empty or remove imports? The instruction says we shouldn't create new files not requested, but we can modify existing ones. The tasks: deliver the extraction and ensure pre-existing tests pass. Pre-existing tests reference mapProviderStatus from their modules: test file imports from '../src/orders/orders.status.js', same for payouts status. If we delete those files, tests will break (unless we modify tests, which is not allowed). But we could preserve those files and make them delegate to shared mapper. That would keep test imports functional. Indeed we need to preserve the existing exports `mapProviderStatus` in each module to maintain backward compatibility (the tests import from there). So we can keep those modules but adjust them to delegate to the shared mapper with appropriate behavior.

Thus for each module:

- src/orders/orders.status.ts: Should export type OrderStatus and function mapProviderStatus that calls PaymentStatusMapper.mapProviderStatusToOrder. Or call raw mapper and throw if unknown. Use the shared mapper.

- src/payouts/payouts.status.ts: Export type PayoutStatus and function mapProviderStatus that calls PaymentStatusMapper.mapProviderStatusToPayout.

- scripts/reporting.ts: The mapProviderStatus function can be replaced to delegate to shared mapper with legacyReportCasing true. Also need to adjust imports accordingly: import { mapProviderStatusToReport } from '../src/shared/payment-status-mapper.js' (path relative). Since the script is at top-level folder scripts, we can import accordingly. Use appropriate relative path: `import { mapProviderStatusToReport } from '../src/shared/payment-status-mapper.js';`. Or using absolute import via tsconfig path? Not defined. We'll use relative path.

We also need to preserve the behavior for unknown codes: script returns null currently; our mapper returns null for unknown.

Now we must write characterization tests for reporting copy before moving anything. But after extraction we will have new behavior that replicates old. However we need to write those tests before extraction; but for solution we need to deliver them now. It doesn't matter if we write them now; they should test the current behavior (which is the same after extraction). So we need to add a new test file for reporting: maybe test/reporting.status.spec.ts. It should import mapProviderStatus from scripts/reporting.ts (or maybe from script path). We need to pin current output for all statuses (including the quirk). So we need to test mapping for all provider codes. Let's enumerate all provider codes across modules:

- 'PENDING'
- 'AWAITING_PAYMENT'
- 'AUTHORIZED'
- 'CAPTURED'
- 'SETTLED'
- 'PAYOUT_SETTLED'
- 'REFUNDED'
- 'PARTIAL_REFUND'
- 'PAYOUT_REVERSED'
- 'DECLINED'
- 'EXPIRED'
- 'CHARGEBACK'

But in reporting script, the mapping didn't include 'PAYOUT_SETTLED' and 'PAYOUT_REVERSED', but after extraction we will include them as union; mapping for those codes will be like 'paid' and 'refunded' (since they are not present in original script mapping). The original script didn't have these codes; but the requirement: "extract a single PaymentStatusMapper covering the union of provider codes; the three call sites delegate to it." This means after refactor, reporting script will also support those extra codes, mapping to internal statuses (lowercase). That's okay; tests should assert for the original set of codes plus maybe new? However we need to write characterization tests for the reporting copy before moving anything, pinning its current output for all statuses (including the quirk). That means we need to test mapping for each status that the reporting script currently supports. It does not support payout-specific codes; it's okay if we don't test them. But after extraction, the mapping for those codes will be added; no test needed. So we need to test mapping for each code currently present in reporting script: the same as orders/payouts mapping (minus extra ones). However we can also test unknown code behavior: unknown returns null.

Specifically, tests should cover:

- 'PENDING' and 'AWAITING_PAYMENT' => 'pending'
- 'AUTHORIZED' => 'authorized'
- 'CAPTURED' and 'SETTLED' => 'paid'
- 'REFUNDED' and 'PARTIAL_REFUND' => 'refunded'
- 'DECLINED' and 'EXPIRED' => 'FAILED' (uppercase)
- 'CHARGEBACK' => 'chargeback'
- unknown code like 'WHATEVER' => null

We should also test that mapProviderStatus returns null for unknown codes.

Potential edge cases: Should test that 'UNKNOWN' also returns null.

Write a test file: test/reporting.status.spec.ts.

Now need to adjust imports accordingly: import { mapProviderStatus } from '../scripts/reporting.js' (since test file resides in test/ folder). The code uses ESM with .js extension when compiled. So we import from '../scripts/reporting.js'.

Now we need to update code.

Implement shared mapper.

Add src/shared/payment-status-mapper.ts.

Define internal types:

- internal status type as union of all possible statuses (excluding unknown). Actually we also need unknown but internal type may not include unknown; we handle unknown separately.

Better to define:

```ts
export type InternalStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';
```

And the raw mapping function returns InternalStatus | undefined.

Define:

```
export class PaymentStatusMapper {
  static rawMapProviderStatus(code: string): InternalStatus | undefined { ... }
  static mapToOrderStatus(code: string): OrderStatus { ... }
  static mapToPayoutStatus(code: string): PayoutStatus { ... }
  static mapToReportStatus(code: string, options?: { legacyReportCasing?: boolean }): string | null { ... }
}
```

Or just export functions without class.

Given the name `PaymentStatusMapper`, a class is more appropriate.

Now need to define OrderStatus and PayoutStatus types.

Orders status type currently defined in src/orders/orders.status.ts. We can import that type into the shared file, but it would create a circular dependency? Actually orders status file currently defines type OrderStatus, which we could keep but we might need to import that type to shared file. However, if we keep the type definitions in each module and the shared mapper returns type OrderStatus (type alias). That is okay. But the mapping functions need to refer to the type. We could either import type definitions from the modules (which might cause the module to import from the shared mapper again? But we can import types only; no runtime import required. That is fine.

Alternatively, we could duplicate type definitions in shared file. But for consistency, better to reuse definitions. However we might have to adjust orders/status.ts to import PaymentStatusMapper and delegate, returning OrderStatus type.

But to avoid circular dependencies, we need to check import graph.

- src/orders/orders.status.ts currently imports nothing and exports OrderStatus and mapProviderStatus. After refactor, we will modify it to import PaymentStatusMapper from src/shared/payment-status-mapper.ts, and export the same OrderStatus type but maybe import it from somewhere else? It could keep its own OrderStatus type definition (since it's still needed for OrdersService return type). It can be defined there. Then the mapProviderStatus function can delegate: `return PaymentStatusMapper.mapToOrderStatus(code)`. That uses shared class.

- src/payouts/payouts.status.ts will also import PaymentStatusMapper and define its own PayoutStatus type and mapProviderStatus function delegating accordingly.

- scripts/reporting.ts will import PaymentStatusMapper.mapToReportStatus with legacyReportCasing true.

Thus shared mapper should be independent of OrderStatus and PayoutStatus types (just return InternalStatus). Actually mapToOrderStatus returns OrderStatus type, but we can define it within shared file. But better to keep OrderStatus type inside orders.status.ts; shared mapper's mapToOrderStatus returns the union type 'pending'|'authorized'|'paid'|'refunded'|'failed'|'chargeback' (same as internal status). That's the same as OrderStatus type, just maybe we need to type cast. Since we want to ensure compile passes, we can define OrderStatus in the shared file as internal status union and export it for use by orders module? But the orders module already defines it. It might cause duplicate type definitions but it's fine because they are same shape.

Better approach: define internal status union type in shared file and then export it. Then orders module can import the type? However orders module expects its own OrderStatus type (exported). For backward compatibility, we keep order status type defined there; we could alias it to the shared type: `export type OrderStatus = InternalStatus;`. However the original file includes a comment about provider mapping for order detail screen. That type can be kept there but simply alias to InternalStatus. That's okay.

Similarly payouts status includes 'unknown' addition; we can define PayoutStatus there.

Implementation Plan:

- Add src/shared/payment-status-mapper.ts.

Implementation details:

```ts
// src/shared/payment-status-mapper.ts
export type InternalStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';

/**
 * Maps a provider status code to an internal status.
 * Returns undefined for unknown codes.
 */
export function rawMapProviderStatus(code: string): InternalStatus | undefined {
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
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      return undefined;
  }
}

/**
 * Mapper for use in orders module.
 * Throws on unknown provider status.
 */
export function mapProviderStatusToOrder(code: string): InternalStatus {
  const status = rawMapProviderStatus(code);
  if (status === undefined) {
    throw new Error(`unknown provider status: ${code}`);
  }
  return status;
}

/**
 * Mapper for use in payouts module.
 * Returns 'unknown' for unknown provider status.
 */
export function mapProviderStatusToPayout(code: string): string {
  const status = rawMapProviderStatus(code);
  return status ?? 'unknown';
}

/**
 * Mapper for use in reporting script.
 * Returns null for unknown provider status.
 * If options?.legacyReportCasing is true, maps 'failed' to 'FAILED'.
 */
export function mapProviderStatusToReport(
  code: string,
  options?: { legacyReportCasing?: boolean },
): string | null {
  const status = rawMapProviderStatus(code);
  if (status === undefined) {
    return null;
  }
  if (options?.legacyReportCasing && status === 'failed') {
    return 'FAILED';
  }
  return status;
}
```

However we also need to export a class `PaymentStatusMapper`. The spec says extract a single `PaymentStatusMapper` into src/shared/. Could be a class containing those static methods.

Let's implement:

```ts
export class PaymentStatusMapper {
  static rawMapProviderStatus(code: string): InternalStatus | undefined { ... }
  static mapToOrderStatus(code: string): InternalStatus { ... }
  static mapToPayoutStatus(code: string): string { ... }
  static mapToReportStatus(code: string, options?: { legacyReportCasing?: boolean }): string | null { ... }
}
```

Now, the modules will import the class and call methods.

Alternatively we can export both class and helper functions; but spec only requires the class.

Thus we will create file src/shared/payment-status-mapper.ts with class.

Now modify src/orders/orders.status.ts:

- Keep type OrderStatus = 'pending'|'authorized'|'paid'|'refunded'|'failed'|'chargeback';

- Export mapProviderStatus delegating: `import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';` (relative path from src/orders to src/shared). Actually file path: src/orders/orders.status.ts is in src/orders. So relative path to src/shared/payment-status-mapper.ts is `../shared/payment-status-mapper.js`. Use .js extension for compiled import. So code:

```ts
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

export type OrderStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  // Throws on unknown provider status as before.
  return PaymentStatusMapper.mapToOrderStatus(code) as OrderStatus;
}
```

But note: PaymentStatusMapper.mapToOrderStatus returns InternalStatus, which is union same as OrderStatus. So cast not necessary, but TypeScript may infer union matches. Should be okay.

Now modify src/payouts/payouts.status.ts:

- Keep type PayoutStatus union includes unknown:

```ts
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  return PaymentStatusMapper.mapToPayoutStatus(code) as PayoutStatus;
}
```

But mapToPayoutStatus returns string, could be 'unknown' or internal statuses (lowercase). That's fine.

Now modify scripts/reporting.ts:

Currently defines mapProviderStatus and buildRows. We'll refactor to use PaymentStatusMapper.mapToReportStatus.

We need to preserve the quirk: the script uses mapProviderStatus that returns uppercase 'FAILED' for declined/expired. To preserve, we call PaymentStatusMapper.mapToReportStatus with legacyReportCasing true.

Thus:

```ts
import { PaymentStatusMapper } from '../src/shared/payment-status-mapper.js';

export interface ReportRow { ... }

export function mapProviderStatus(code: string): string | null {
  return PaymentStatusMapper.mapToReportStatus(code, { legacyReportCasing: true });
}
```

But note path from scripts/reporting.ts to src/shared/payment-status-mapper.ts: script located at scripts/, so relative path `../src/shared/payment-status-mapper.js`. Use that.

Now keep buildRows unchanged.

Now add new test file test/reporting.status.spec.ts as described. Must import mapProviderStatus from '../scripts/reporting.js'.

Add tests for each status.

Implementation:

```ts
import { describe, expect, it } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping', () => {
  it('maps pending codes to "pending"', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized code to "authorized"', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled codes to "paid"', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund codes to "refunded"', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps decline/expired codes to uppercase "FAILED"', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback code to "chargeback"', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown provider codes', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
  });
});
```

Thus characterization test.

Now update any imports that refer to mapProviderStatus for orders and payouts.

Check src/orders/orders.service.ts imports mapProviderStatus from './orders.status.js'. After our modification, that file still exports mapProviderStatus but delegating. So no changes needed.

Check src/payouts/payouts.service.ts imports mapProviderStatus from './payouts.status.js'. No change needed.

Thus pre-existing tests should still pass.

Now we need to ensure TypeScript imports are correct: we need to use .js extensions for imports due to ES modules, as seen in original code they use `import { mapProviderStatus, type OrderStatus } from './orders.status.js';` in orders.service.ts. So we need to follow same pattern: in our modules, use .js.

Thus modify src/orders/orders.status.ts:

Add import: `import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';`

Similarly modify src/payouts/payouts.status.ts: import from '../shared/payment-status-mapper.js'.

Now, we need to ensure that the relative path is correct for both modules.

- src/orders/orders.status.ts location: src/orders/
- relative path to src/shared/payment-status-mapper.ts: go up one level to src (..), then into shared: `../shared/payment-status-mapper.js`. Indeed.

- src/payouts/payouts.status.ts location: src/payouts/
- relative path same: `../shared/payment-status-mapper.js`.

Now we need to create src/shared folder with payment-status-mapper.ts.

Add file.

Now we need to create NOTES.md describing the divergence.

Thus add a file NOTES.md at repository root with required documentation.

Spec: Document the three copies, the quirk, and the deliberate divergence. Provide a line saying it's deliberate and what would have to be checked before unifying.

Content:

```
# Payment status mapping notes

This repository contains three historically separate mappings from provider status codes to internal statuses:

- **Orders module** (`src/orders/orders.status.ts`): maps known provider codes to an `OrderStatus` and throws an error for unknown codes.
- **Payouts module** (`src/payouts/payouts.status.ts`): maps known provider codes (including two payout‑specific codes) to a `PayoutStatus`. For unknown codes it returns `'unknown'` so the reconciliation process can continue.
- **Reporting script** (`scripts/reporting.ts`): maps known provider codes to a string used in CSV reports. Unknown codes result in `null` (the row is skipped). It also has a legacy quirk: for the `DECLINED` and `EXPIRED` provider codes the status string is upper‑cased to `'FAILED'` to keep backward compatibility with existing finance spreadsheets.

The three behaviours have been deliberately preserved:

- **Throw on unknown** – required by the orders UI to surface integration problems.
- **Return `'unknown'`** – required by payout reconciliation to keep processing other records.
- **Return `null` (skip row)** – required by the nightly reporting script to omit unsupported rows.

These divergences are documented here and are implemented via the `PaymentStatusMapper` API:
- `mapToOrderStatus` throws on unknown.
- `mapToPayoutStatus` returns `'unknown'` on unknown.
- `mapToReportStatus` returns `null` on unknown and supports the `legacyReportCasing` option to produce the `'FAILED'` upper‑cased value.

**Do not unify these behaviours** without a coordinated change to the UI, reconciliation logic, and finance CSV consumers. Any unification would be a breaking change for at least one consumer.

```

Now add file.

Now confirm everything passes.

Potential compile errors:

- In orders.service.ts they import mapProviderStatus from './orders.status.js' and also type OrderStatus. That file now exports mapProviderStatus and OrderStatus type, fine.

- In payouts.service.ts they import mapProviderStatus and PayoutStatus similarly. Works.

- In scripts/reporting.ts we changed mapProviderStatus to delegate to PaymentStatusMapper.mapToReportStatus with legacyReportCasing: true. It returns string | null. Good.

- buildRows uses mapProviderStatus result; unchanged.

Potential TS errors:

- PaymentStatusMapper.mapToReportStatus returns string | null; we use it in reporting script's mapProviderStatus, return type string | null, same.

- In shared file, we define InternalStatus union and mapToOrderStatus returns InternalStatus. In orders.status.ts we return that as OrderStatus type; they match.

- In payouts status, mapToPayoutStatus returns string; we cast to PayoutStatus. But PayoutStatus includes 'unknown' plus other statuses. The return string might be 'pending', etc. That's okay. However TypeScript may require explicit cast, or we can type the function return as PayoutStatus directly. We'll implement mapToPayoutStatus returning string as internal status union plus 'unknown', i.e., type: `InternalStatus | 'unknown'`. That matches. Could return `'unknown'` as string. So we can define mapToPayoutStatus return type: `string`. That's fine.

But we need to import the class PaymentStatusMapper, which we implement.

Potential missing import path in scripts/reporting.ts: relative path from scripts/reporting.ts to src/shared/payment-status-mapper.js is `'../src/shared/payment-status-mapper.js'`. That should be correct: scripts/ is top-level. So go up to root then src... Actually relative path from scripts/ to src/ is `../src/`. So `'../src/shared/payment-status-mapper.js'` is correct.

Potential TS config include path: includes "scripts/**/*.ts", "src/**/*.ts". So import path can be relative.

Now need to ensure we have .js extension in imports.

- In shared file we may need to export class using `export class PaymentStatusMapper {...}`. That's fine.

- In orders/status.ts we need to import from '../shared/payment-status-mapper.js'. That file is located at src/shared/payment-status-mapper.ts but compiled to .js (runtime). The path relative from src/orders is '../shared/payment-status-mapper.js'.

- In payouts/status.ts same import.

- In scripts/reporting.ts import from '../src/shared/payment-status-mapper.js'.

Potential import naming conflict: In scripts/reporting.ts we might also need to import type for mapProviderStatus? Not needed.

Now we need to ensure we have test file for reporting status; we must add test to repository's test folder.

Add file test/reporting.status.spec.ts as described.

Now we need to run type-check? We need to ensure all imports have .js extension.

Also need to ensure that test files use import with .js. Indeed orders.status.spec.ts imports from '../src/orders/orders.status.js'. That's fine. So our new test file should import from '../scripts/reporting.js'.

Now verify code for PaymentStatusMapper.

Implement class with static methods:

```ts
export class PaymentStatusMapper {
  private static rawMapProviderStatus(code: string): InternalStatus | undefined {
    // as above
  }

  static mapToOrderStatus(code: string): InternalStatus {
    const status = this.rawMapProviderStatus(code);
    if (status === undefined) {
      throw new Error(`unknown provider status: ${code}`);
    }
    return status;
  }

  static mapToPayoutStatus(code: string): string {
    const status = this.rawMapProviderStatus(code);
    return status ?? 'unknown';
  }

  static mapToReportStatus(
    code: string,
    options?: { legacyReportCasing?: boolean },
  ): string | null {
    const status = this.rawMapProviderStatus(code);
    if (status === undefined) {
      return null;
    }
    if (options?.legacyReportCasing && status === 'failed') {
      return 'FAILED';
    }
    return status;
  }
}
```

Now, we need to export InternalStatus? Not necessary. But for completeness we can export type.

Now we need to import `PaymentStatusMapper` in orders and payouts.

Implementation details:

src/orders/orders.status.ts:

```ts
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  // Delegates to shared mapper which throws on unknown
  return PaymentStatusMapper.mapToOrderStatus(code) as OrderStatus;
}
```

Potential compile error: PaymentStatusMapper.mapToOrderStatus returns InternalStatus which is defined in shared file, but not imported here. However we cast to OrderStatus, which is the same union. That's fine.

src/payouts/payouts.status.ts:

```ts
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  return PaymentStatusMapper.mapToPayoutStatus(code) as PayoutStatus;
}
```

Now scripts/reporting.ts:

```ts
import { PaymentStatusMapper } from '../src/shared/payment-status-mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

/**
 * Maps provider status code to CSV status column.
 * The `legacyReportCasing` option enables the historical upper‑casing of the
 * "failed" status required by finance spreadsheets.
 */
export function mapProviderStatus(code: string): string | null {
  return PaymentStatusMapper.mapToReportStatus(code, { legacyReportCasing: true });
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

Check note: we changed condition: previously if (status === null) continue; now same.

Now we need to add documentation comment on the option in the mapper class.

Add comment in shared file.

Now create NOTES.md.

Now confirm all test files.

Now run mental test.

**Test orders.status.spec.ts**:

- It imports mapProviderStatus from '../src/orders/orders.status.js'. Our function delegates to PaymentStatusMapper.mapToOrderStatus which throws on unknown. So test passes.

- It expects mapping for CAPTURED, SETTLED to 'paid' etc. Works.

- It tests that mapProviderStatus('WHATEVER') throws. Our mapToOrderStatus throws on unknown, good.

**Test payouts.status.spec.ts**:

- Import mapProviderStatus from '../src/payouts/payouts.status.js'. Our function returns PaymentStatusMapper.mapToPayoutStatus(code). This function returns status if known, otherwise 'unknown'. So the test only asserts mapProviderStatus('PAYOUT_SETTLED') returns 'paid' and mapProviderStatus('PAYOUT_REVERSED') returns 'refunded'. Works.

Note: There might be test for unknown code not present but fine.

**Test reporting.status.spec.ts** (new file) imports mapProviderStatus from '../scripts/reporting.js'.

Our mapping function returns PaymentStatusMapper.mapToReportStatus with option true, so will map:

- 'PENDING' -> rawMap 'pending' -> status 'pending' (since options only affect 'failed', unchanged). Works.

- 'AWAITING_PAYMENT' -> same.

- 'AUTHORIZED' -> 'authorized'

- 'CAPTURED', 'SETTLED' -> 'paid'

- 'REFUNDED', 'PARTIAL_REFUND' -> 'refunded'

- 'DECLINED', 'EXPIRED' -> rawMap returns 'failed', but options triggers uppercase 'FAILED', returns 'FAILED'.

- 'CHARGEBACK' -> 'chargeback'.

- unknown -> rawMap returns undefined -> mapToReportStatus returns null.

Thus tests should pass.

Potential missing case: rawMap includes mapping for payout specific codes 'PAYOUT_SETTLED', 'PAYOUT_REVERSED', which not tested. That's okay.

Now check code for any other parts that used mapProviderStatus from orders or payouts. In services code, mapProviderStatus is used accordingly. The behavior should remain unchanged. For orders service's toView: it expects mapProviderStatus to return OrderStatus; we have that.

For payouts service's reconcile: they compute status = mapProviderStatus(r.providerStatus). If status === 'paid' etc. It also checks if status === 'unknown' to push to unresolved.

Our mapping returns string 'unknown' for unknown codes, matching earlier behavior. That is correct.

Now we need to ensure that the PayoutsService's status variable type is PayoutStatus (including unknown). Already typed.

Potential TS error: In payouts.service.ts they import `type PayoutStatus` from './payouts.status.js'. That file still exports PayoutStatus type.

Now ensure the import path in src/payouts/payouts.service.ts: `import { mapProviderStatus, type PayoutStatus } from './payouts.status.js';` That file is now delegating.

Now verify that rawMap covers all provider codes used across modules.

List provider codes:

- orders: PENDING, AWAITING_PAYMENT, AUTHORIZED, CAPTURED, SETTLED, REFUNDED, PARTIAL_REFUND, DECLINED, EXPIRED, CHARGEBACK.

- payouts: same plus PAYOUT_SETTLED, PAYOUT_REVERSED.

- reporting: same as orders, but unknown returns null, and quirk for DECLINED/EXPIRED.

Thus rawMap includes all.

Now ensure mapping for 'PAYOUT_SETTLED' returns 'paid' (as in payouts). Yes.

Now ensure mapping for 'PAYOUT_REVERSED' returns 'refunded'.

Now ensure mapping for unknown codes: rawMap returns undefined.

Now ensure that mapToPayoutStatus returns unknown string for unknown codes (i.e., returns 'unknown'). That matches original behavior.

Now ensure that mapToOrderStatus throws.

Now ensure mapToReportStatus returns null.

Now ensure we added legacyReportCasing to only reporting.

Now we need to make sure the imports use .js extension correctly. In shared file, the class is exported; any file that imports it uses .js extension as we wrote.

Now need to verify that the TypeScript config includes src/shared folder (by default includes src/**/*.ts). So the file is part of compilation.

Now create the file src/shared/payment-status-mapper.ts as described.

Now add NOTES.md.

Now test if there are any other code that uses provider status mapping directly (none).

Now confirm that the repository uses "type": "module" and NodeNext module resolution, so imports with file extensions .js are required. Indeed.

Now commit changes.

Potential issues: Path for import in src/orders/orders.status.ts is `'../shared/payment-status-mapper.js'`. Since orders.status.ts resides in src/orders, relative path to src/shared is `../shared`, correct.

Potential path for import in src/payouts/payouts.status.ts: `'../shared/payment-status-mapper.js'`, correct.

Potential path for import in scripts/reporting.ts: `'../src/shared/payment-status-mapper.js'`. Since script is at root/scripts, and shared file is at src/shared. So go up one level to root, then src/shared. That's correct.

Now ensure that there is no naming conflict with the class name.

Potential issue: The original code used `export function mapProviderStatus(code: string): OrderStatus` in orders.status.ts. Our new function also uses same name. That's fine.

Potential compile error: In orders.status.ts we wrote `return PaymentStatusMapper.mapToOrderStatus(code) as OrderStatus;`. But TypeScript's type inference may treat `mapToOrderStatus` return type as `InternalStatus`. Since `OrderStatus` is same union, cast may be unnecessary. Could just return it as is.

Now check for any missing import of types: Not needed.

Potential lint errors: Not relevant.

Now final step: ensure tests run.

Edge cases: The `PaymentStatusMapper.mapToReportStatus` returns a string (lowercase internal status). In reporting script, the status column is typed as string. That's fine. The buildRows expects status string. All good.

Now we must produce final answer: list each file with heading and fenced content.

Files to output:

- src/shared/payment-status-mapper.ts
- src/orders/orders.status.ts (modified)
- src/payouts/payouts.status.ts (modified)
- scripts/reporting.ts (modified)
- test/reporting.status.spec.ts (new)
- NOTES.md (new)

We also need to include the unchanged files? The instruction says deliver every file the solution needs. It does not require us to include unchanged files. It says "Do not restate a file you are not changing, and do not invent a replacement for one you were shown." That means we should not output the unchanged files (they exist unchanged). However we are adding new files and modifying some. So we should only output the modified files and new files.

We must also modify src/orders/orders.service.ts? No changes needed, as mapProviderStatus signature remains same.

Thus output the changed files and new files.

Let's double-check modifications to src/orders/orders.status.ts and src/payouts/payouts.status.ts.

Original src/orders/orders.status.ts:

```ts
// Provider status -> internal status, for the order detail screen.
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  switch (code) {
    case 'PENDING':
    case 'AWAITING_PAYMENT':
      return 'pending';
    case 'AUTHORIZED':
      return 'authorized';
    case 'CAPTURED':
    case 'SETTLED':
      return 'paid';
    case 'REFUNDED':
    case 'PARTIAL_REFUND':
      return 'refunded';
    case 'DECLINED':
    case 'EXPIRED':
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      throw new Error(`unknown provider status: ${code}`);
  }
}
```

We will modify to import PaymentStatusMapper and delegate.

Thus new file:

```ts
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

/**
 * Provider status → internal status, for the order detail screen.
 *
 * Delegates to the shared {@link PaymentStatusMapper}. Unknown provider codes
 * result in an exception, matching the original behaviour.
 */
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  // The shared mapper throws on unknown codes.
  return PaymentStatusMapper.mapToOrderStatus(code) as OrderStatus;
}
```

Note: Add comment referencing shared mapper.

Now src/payouts/payouts.status.ts original:

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

export function mapProviderStatus(code: string): PayoutStatus {
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
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      // Reconciliation must not stop on a code we have not seen yet.
      return 'unknown';
  }
}
```

Modify to import mapper.

```ts
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

/**
 * Provider status → internal status, for payout reconciliation.
 *
 * Delegates to the shared {@link PaymentStatusMapper}. Unknown provider codes
 * result in `'unknown'`, matching the original behaviour.
 */
export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  return PaymentStatusMapper.mapToPayoutStatus(code) as PayoutStatus;
}
```

Now scripts/reporting.ts original and new.

Original:

```ts
export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

export function mapProviderStatus(code: string): string | null {
  switch (code) {
    case 'PENDING':
    case 'AWAITING_PAYMENT':
      return 'pending';
    case 'AUTHORIZED':
      return 'authorized';
    case 'CAPTURED':
    case 'SETTLED':
      return 'paid';
    case 'REFUNDED':
    case 'PARTIAL_REFUND':
      return 'refunded';
    case 'DECLINED':
    case 'EXPIRED':
      // finance's sheet filters on the upper-cased value in this column
      return 'FAILED';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      return null;
  }
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

New version:

```ts
import { PaymentStatusMapper } from '../src/shared/payment-status-mapper.js';

/**
 * CSV report row.
 */
export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

/**
 * Maps provider status code to CSV status column.
 *
 * The `legacyReportCasing` option reproduces the historical quirk where the
 * "failed" status is upper‑cased to `"FAILED"` for finance spreadsheets.
 */
export function mapProviderStatus(code: string): string | null {
  return PaymentStatusMapper.mapToReportStatus(code, { legacyReportCasing: true });
}

/**
 * Builds report rows, skipping payments with an unknown provider status.
 */
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

Now shared file.

Add file src/shared/payment-status-mapper.ts

Implementation as described.

Add file test/reporting.status.spec.ts.

Implementation as described.

Add file NOTES.md.

Now we must ensure that the relative path for import in scripts/reporting.ts is correct: `'../src/shared/payment-status-mapper.js'`. Indeed script folder path is root/scripts; go up to root: `..` (which is root) then `src/shared/...`. So `'../src/shared/payment-status-mapper.js'`.

Check path for imports in src/orders/orders.status.ts and src/payouts/payouts.status.ts: `'../shared/payment-status-mapper.js'` is correct relative from src/orders and src/payouts.

Now confirm that the new shared file does not rely on any other imports.

Now double-check that there are no other imports referencing mapProviderStatus from other modules (e.g., maybe the main file). No.

Now check that test files compile.

Test file test/reporting.status.spec.ts imports mapProviderStatus from '../scripts/reporting.js'. The script now imports shared mapper; okay.

Potential TypeScript errors: The import statement with .js extension from TypeScript files may cause the compiler to look for .js file at compile time, but tsconfig's moduleResolution is NodeNext, which uses .js extension to locate .ts source. This works.

Now check building and running tests with Vitest.

Potential errors:

- In the new test file, we call `expect(mapProviderStatus('WHATEVER')).toBeNull();` But mapProviderStatus returns `null` for unknown, correct.

- Ensure that mapProviderStatus returns exactly `null`, not undefined. In our code, mapToReportStatus returns null for undefined. So fine.

Potential error: In mapProviderStatus in scripts/reporting.ts, we return string | null. But the function mapToReportStatus returns string | null. So fine.

Potential error: The mapping for unknown codes may produce undefined before being turned into null; but our mapToReportStatus returns null; fine.

Potential error: In mapToReportStatus, we call rawMapProviderStatus which returns InternalStatus | undefined. For unknown, status undefined, return null. Good.

Now check that rawMapProviderStatus includes mapping for 'PAYOUT_SETTLED' and 'PAYOUT_REVERSED'. In reporting original script, those codes were not considered; but after extraction they will map to 'paid' and 'refunded', respectively. The test doesn't cover those codes; they will be accepted.

Potential error: In the mapping for 'FAILED', we have condition `if (options?.legacyReportCasing && status === 'failed') { return 'FAILED'; }` So it returns 'FAILED' only for 'failed'. Good.

Now note that for unknown codes, mapProviderStatus returns null; then buildRows continues (skip). That's same as original script.

Now we must verify that the repository's tests pass.

Running mental simulation:

- orders.status.spec.ts: mapProviderStatus('CAPTURED') -> PaymentStatusMapper.mapToOrderStatus('CAPTURED') -> rawMap returns 'paid', returns 'paid'. Expect 'paid' => pass.

- mapProviderStatus('REFUNDED') -> returns 'refunded'.

- mapProviderStatus('WHATEVER') -> rawMap undefined -> throw. The mapToOrderStatus throws, test expects throw -> pass.

- payouts.status.spec.ts: mapProviderStatus('PAYOUT_SETTLED') -> PaymentStatusMapper.mapToPayoutStatus('PAYOUT_SETTLED') -> rawMap returns 'paid' (including mapping). The function returns status (not undefined). Then cast to PayoutStatus; test expects 'paid' -> pass.

- mapProviderStatus('PAYOUT_REVERSED') -> rawMap returns 'refunded' -> pass.

- test/reporting.status.spec.ts:

Check each mapping:

- mapProviderStatus('PENDING') -> PaymentStatusMapper.mapToReportStatus('PENDING', { legacyReportCasing: true }) -> rawMap returns 'pending', status !== 'failed', returns 'pending'. Pass.

- mapProviderStatus('AWAITING_PAYMENT') -> same.

- mapProviderStatus('AUTHORIZED') -> rawMap returns 'authorized', pass.

- mapProviderStatus('CAPTURED') -> rawMap 'paid', pass.

- mapProviderStatus('SETTLED') -> 'paid', pass.

- mapProviderStatus('REFUNDED') -> 'refunded', pass.

- mapProviderStatus('PARTIAL_REFUND') -> 'refunded', pass.

- mapProviderStatus('DECLINED') -> rawMap 'failed', option triggers uppercase => returns 'FAILED', pass.

- mapProviderStatus('EXPIRED') -> 'FAILED'.

- mapProviderStatus('CHARGEBACK') -> rawMap 'chargeback' -> pass.

- mapProviderStatus('WHATEVER') -> rawMap undefined -> return null -> test expects null, pass.

Thus all tests should pass.

Now note that we added a new test, but the problem says "Write characterization tests for the reporting copy first, pinning its current output for all statuses (including the quirk)." That is satisfied.

Now we must produce final answer with file headings.

List of files to output:

- src/shared/payment-status-mapper.ts
- src/orders/orders.status.ts
- src/payouts/payouts.status.ts
- scripts/reporting.ts
- test/reporting.status.spec.ts
- NOTES.md

Potential other files: Could also need to adjust path in src/payouts/payouts.service.ts? It imports mapProviderStatus from './payouts.status.js'. That's fine.

One more: Did we import PaymentStatusMapper into src/payouts/payouts.status.ts and src/orders/orders.status.ts using the relative path with .js extension? Yes.

Now verify that the import in src/orders/orders.status.ts uses `../shared/payment-status-mapper.js`. Since file is at src/orders/orders.status.ts, that path resolves to src/shared/payment-status-mapper.js. Good.

Now verify that the code has correct ESM syntax.

Now check that the file name for shared file is correct: src/shared/payment-status-mapper.ts. The import will resolve to .js due to NodeNext.

Now write file content.

Potential type import: In src/orders/orders.status.ts we used `import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';`. That's fine.

Now we may need to export the class. In shared file we need to `export class PaymentStatusMapper` and maybe also export types for external usage? Not required.

Now produce final answer.
```

## reply

### src/shared/payment-status-mapper.ts
```ts
/**
 * Centralised mapper for provider status codes.
 *
 * The mapper knows the union of all provider codes used across the
 * application (orders, payouts, and reporting). Each public method preserves
 * the behaviour required by its original location:
 *
 * - `mapToOrderStatus` throws on unknown codes (orders module).
 * - `mapToPayoutStatus` returns `'unknown'` on unknown codes (payouts module).
 * - `mapToReportStatus` returns `null` on unknown codes and can apply the
 *   legacy upper‑casing quirk via the `legacyReportCasing` option
 *   (reporting script).
 */
export class PaymentStatusMapper {
  /**
   * Internal status values used by the application.
   */
  private static readonly internalStatuses = [
    'pending',
    'authorized',
    'paid',
    'refunded',
    'failed',
    'chargeback',
  ] as const;

  /**
   * Raw mapping from provider status to internal status.
   *
   * Returns `undefined` for unknown provider codes.
   */
  private static rawMapProviderStatus(code: string): (typeof this.internalStatuses)[number] | undefined {
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
        return 'failed';
      case 'CHARGEBACK':
        return 'chargeback';
      default:
        return undefined;
    }
  }

  /**
   * Mapping for the orders module.
   *
   * Mirrors the original behaviour: throws on unknown provider status.
   */
  static mapToOrderStatus(code: string): (typeof this.internalStatuses)[number] {
    const status = this.rawMapProviderStatus(code);
    if (status === undefined) {
      throw new Error(`unknown provider status: ${code}`);
    }
    return status;
  }

  /**
   * Mapping for the payouts module.
   *
   * Mirrors the original behaviour: returns `'unknown'` for unknown provider status.
   */
  static mapToPayoutStatus(code: string): string {
    const status = this.rawMapProviderStatus(code);
    return status ?? 'unknown';
  }

  /**
   * Mapping for the reporting script.
   *
   * Mirrors the original behaviour: returns `null` for unknown provider status.
   * When `legacyReportCasing` is true, the `"failed"` status is upper‑cased to
   * `"FAILED"` to keep the historic CSV format.
   */
  static mapToReportStatus(
    code: string,
    options?: { legacyReportCasing?: boolean },
  ): string | null {
    const status = this.rawMapProviderStatus(code);
    if (status === undefined) {
      return null;
    }
    if (options?.legacyReportCasing && status === 'failed') {
      return 'FAILED';
    }
    return status;
  }
}
```

### src/orders/orders.status.ts
```ts
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

/**
 * Provider status → internal status, for the order detail screen.
 *
 * Delegates to the shared {@link PaymentStatusMapper}. Unknown provider codes
 * result in an exception, matching the original behaviour.
 */
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  // The shared mapper throws on unknown codes.
  return PaymentStatusMapper.mapToOrderStatus(code) as OrderStatus;
}
```

### src/payouts/payouts.status.ts
```ts
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

/**
 * Provider status → internal status, for payout reconciliation.
 *
 * Delegates to the shared {@link PaymentStatusMapper}. Unknown provider codes
 * result in `'unknown'`, matching the original behaviour.
 */
export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  return PaymentStatusMapper.mapToPayoutStatus(code) as PayoutStatus;
}
```

### scripts/reporting.ts
```ts
import { PaymentStatusMapper } from '../src/shared/payment-status-mapper.js';

/**
 * CSV report row.
 */
export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

/**
 * Maps provider status code to CSV status column.
 *
 * The `legacyReportCasing` option reproduces the historical quirk where the
 * "failed" status is upper‑cased to `"FAILED"` for finance spreadsheets.
 */
export function mapProviderStatus(code: string): string | null {
  return PaymentStatusMapper.mapToReportStatus(code, { legacyReportCasing: true });
}

/**
 * Builds report rows, skipping payments with an unknown provider status.
 */
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
  it('maps pending codes to "pending"', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized code to "authorized"', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled codes to "paid"', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund codes to "refunded"', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps decline/expired codes to uppercase "FAILED"', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback code to "chargeback"', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown provider codes', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
  });
});
```

### NOTES.md
```
# Payment status mapping notes

This repository contains three historically separate mappings from provider
status codes to internal statuses:

- **Orders module** (`src/orders/orders.status.ts`): maps known provider codes
  to an `OrderStatus` and throws an error for unknown codes.
- **Payouts module** (`src/payouts/payouts.status.ts`): maps known provider
  codes (including two payout‑specific codes) to a `PayoutStatus`. For unknown
  codes it returns `'unknown'` so the reconciliation process can continue.
- **Reporting script** (`scripts/reporting.ts`): maps known provider codes to a
  string used in CSV reports. Unknown codes result in `null` (the row is
  skipped). It also has a legacy quirk: for the `DECLINED` and `EXPIRED`
  provider codes the status string is upper‑cased to `'FAILED'` to keep
  backward compatibility with existing finance spreadsheets.

The three behaviours have been deliberately preserved:

- **Throw on unknown** – required by the orders UI to surface integration
  problems.
- **Return `'unknown'`** – required by payout reconciliation to keep processing
  other records.
- **Return `null` (skip row)** – required by the nightly reporting script to
  omit unsupported rows.

These divergences are documented here and are implemented via the
`PaymentStatusMapper` API:

- `mapToOrderStatus` throws on unknown.
- `mapToPayoutStatus` returns `'unknown'` on unknown.
- `mapToReportStatus` returns `null` on unknown and supports the
  `legacyReportCasing` option to produce the `'FAILED'` upper‑cased value.

**Do not unify these behaviours** without a coordinated change to the UI,
reconciliation logic, and finance CSV consumers. Any unification would be a
breaking change for at least one consumer.
```
