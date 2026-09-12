# solution

## reasoning

```
We have a scenario where we need to implement the refactor.

We need to add a shared mapper that centralizes provider status mapping, and adjust the three call sites (orders, payouts, reporting script) to delegate to it. Add an option for the reporting script's "legacyReportCasing" which changes the output for certain status (currently 'DECLINED' and 'EXPIRED' map to 'FAILED' uppercase). But note: In orders, mapProviderStatus returns lowercase 'failed'. In payouts, they map same statuses (including those two) to 'failed'. In reporting script, they map these to uppercase 'FAILED'. Also note that reporting script also returns null for unknown codes (skip). In orders, unknown code throws error. In payouts, unknown code returns 'unknown'.

We need to preserve these behaviours. The shared mapper should provide functionality to map provider code to internal status, maybe returning string (the internal status) or maybe also provide the ability to treat unknown codes in different ways.

Given we need to preserve each call site's unknown behavior, the mapper's API must be flexible: maybe we can have a function mapProviderStatus(code: string, options?: { unknown?: 'throw' | 'unknown' | 'skip' })? But orders and payouts use separate functions originally; we need to adjust them to call the shared mapper with appropriate handling.

We need to write tests for the reporting script copy (characterization tests) before moving. Since we cannot modify existing test files except adding new tests. We'll create a new test file e.g., test/reporting.spec.ts that imports mapProviderStatus from scripts/reporting.ts? Actually the script's mapProviderStatus function is in scripts/reporting.ts. We will need to replace that logic with call to shared mapper, but we should preserve output. So we need to add a shared mapper file: src/shared/payment-status-mapper.ts (or src/shared/payment-status-mapper.ts). This will contain a class or functions. Since we have a functional style, we can export a function mapProviderStatus that takes code and options: { unknownBehavior?: 'throw' | 'return-unknown' | 'skip', legacyReportCasing?: boolean }. For each call site, we call with appropriate options.

But the repository currently does not have any NestJS modules or dependency injection; it's just simple TS. However, the instruction says this is a fixture of a NestJS API, but we have only these modules as separate files. The mapping is just function. So we can implement a plain function in src/shared/payment-status-mapper.ts.

Implementation details:

We need to cover the union of provider codes across all three copies:

List provider codes from orders: 'PENDING','AWAITING_PAYMENT','AUTHORIZED','CAPTURED','SETTLED','REFUNDED','PARTIAL_REFUND','DECLINED','EXPIRED','CHARGEBACK'.

From payouts: same plus 'PAYOUT_SETTLED','PAYOUT_REVERSED'.

From reporting: same as orders (except maybe not CHARGEBACK? It has CHARGEBACK mapping). Indeed reporting includes same as orders, also 'CHARGEBACK'.

Thus union is as above.

Mapping to internal status: internal statuses in orders: pending, authorized, paid, refunded, failed, chargeback. For payouts, internal statuses include unknown additional, but mapping same as orders plus extra codes map to same internal statuses. So we can define a mapping function that returns internal status string (lowercase) for known codes, else unknown.

For unknown handling:

- In orders: unknown should throw error. So options unknownBehavior: 'throw' default maybe? Actually we can default to 'throw' for orders, but for payouts we pass 'return-unknown', for reporting we pass 'skip' (meaning returns null). So the mapper could return string | null, and for orders we throw on unknown, for payouts we return 'unknown', for reporting we return null.

- For reporting we also need to apply legacyReportCasing: if true and status is 'failed' we need to return 'FAILED' (uppercase). Wait: In reporting script mapping: they map DECLINED, EXPIRED to 'FAILED' (uppercase). The internal status 'failed' is lowercase. So the mapping for reporting should output uppercase 'FAILED' if legacyReportCasing is true, else maybe 'failed'? Actually the reporting script only uses this mapping. It expects uppercase for 'FAILED', but other statuses are lower case. Let's check the reporting script's mapping: returns 'failed' is not used; they map DECLINED/EXPIRED to 'FAILED' uppercase; others (like 'PENDING','AUTHORIZED','CAPTURED','REFUNDED','CHARGEBACK') map to lower-case strings. So we need to implement mapping where we produce lower-case for normal statuses, but when legacyReportCasing is true, for the 'failed' status we return 'FAILED' uppercase. That's the quirk.

Potentially also the script maps unknown provider statuses to null (skip). So unknownBehavior 'skip' returns null.

Thus, we need to implement the mapper accordingly.

Implementation plan:

src/shared/payment-status-mapper.ts:

```ts
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

// Options interface
export interface PaymentStatusMapperOptions {
  unknownBehavior?: 'throw' | 'return-unknown' | 'skip'; // default 'throw'
  legacyReportCasing?: boolean; // default false
}

/**
 * Maps a provider status code to an internal payment status.
 *
 * @param code Provider status string.
 * @param options Mapping options.
 * @returns The mapped status (lowercase string), or null if options.unknownBehavior is 'skip'.
 *
 * @throws when options.unknownBehavior === 'throw' and code is unknown.
 */
export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {}
): string | null {
  const { unknownBehavior = 'throw', legacyReportCasing = false } = options;
  // Map provider codes to internal status (lowercase)
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
      // base status is 'failed'
      if (legacyReportCasing) {
        return 'FAILED'; // quirk
      }
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      // unknown
      if (unknownBehavior === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      } else if (unknownBehavior === 'return-unknown') {
        return 'unknown';
      } else if (unknownBehavior === 'skip') {
        return null;
      }
      // Fallback - should not happen
      return null;
  }
}
```

But note: In the case of legacyReportCasing, we return uppercase 'FAILED' string, but our return type is string | null. For consistency, for other statuses we return lowercase strings. This matches the reporting script's expectation: statuses like 'pending','authorized','paid','refunded','chargeback' (lowercase). For 'FAILED' uppercase they treat it specially.

But we must also consider that the internal mapping for orders and payouts expects lowercase 'failed'. Our mapper's default behavior is to return lowercase 'failed', which is good.

Now modify orders module to use the shared mapper.

In src/orders/orders.service.ts, change import: import { mapProviderStatus } from '../../shared/payment-status-mapper' maybe relative path. Since file is src/orders/orders.service.ts. The shared file is src/shared/payment-status-mapper.ts.

But they also import type OrderStatus from './orders.status.js', which defines the type. We'll need to keep that type for orders. We can either keep the type definitions in orders.status.ts, maybe they import that type for type safety. But the mapping function now is in shared. Should we still keep orders.status.ts? The spec says "extract a single PaymentStatusMapper into src/shared/, covering the union of provider codes; the three call sites delegate to it." It does not say we must delete the old mapping files. But after moving, we need to ensure that the old files are not used, and that they contain no mapping logic? Possibly we should delete them or at least adjust them to delegate to the shared mapper, but they may be unused. However tests import mapProviderStatus from src/orders/orders.status.js and src/payouts/payouts.status.js directly; the tests are existing and we need them to pass unchanged. So we cannot change the module path that tests import. The tests refer to `../src/orders/orders.status.js`. So we need to keep those modules and preserve their exported function name mapProviderStatus, but have them delegate to the shared mapper. That satisfies "all three call sites delegate to it" because the call sites are orders.service, payouts.service, and reporting script. But there is also the mapping functions in orders.status.ts and payouts.status.ts used by tests; they could be considered call sites (they are modules that expose mapping). However the instruction may be interpreted as the service and script should delegate, not necessarily these status modules. But to reduce duplication, we could keep the status modules as wrappers that call the shared mapper with appropriate options.

But also note that orders.status.ts throws on unknown; this matches orders unknown behavior, so we can delegate with unknownBehavior = 'throw'. Similarly payouts.status.ts should delegate with unknownBehavior = 'return-unknown'.

Thus we can modify orders/status.ts and payouts/status.ts to import shared mapper.

However we must keep the types (OrderStatus, PayoutStatus) defined there because tests import them, plus other code might use them. So we maintain the type definitions unchanged. In the mapping functions we just delegate.

Thus:

src/orders/orders.status.ts:

```ts
import { mapProviderStatus as sharedMapProviderStatus } from '../../shared/payment-status-mapper.js';
export type OrderStatus = ... // unchanged

export function mapProviderStatus(code: string): OrderStatus {
  // use shared mapper with default unknown behavior (throw)
  // The shared mapper returns string | null; but orders expects OrderStatus (no null). It will throw on unknown.
  const result = sharedMapProviderStatus(code, { unknownBehavior: 'throw' });
  // result is string (lowercase). Type cast to OrderStatus.
  // The shared mapper returns 'FAILED' only if legacyReportCasing is true; we won't set that, so we get 'failed'.
  return result as OrderStatus;
}
```

But note: shared mapper returns uppercase 'FAILED' only if legacyReportCasing true. Here it's false. So mapping returns 'failed' for those codes, which matches order's type includes 'failed'.

Now src/payouts/payouts.status.ts:

```ts
import { mapProviderStatus as sharedMapProviderStatus } from '../../shared/payment-status-mapper.js';
export type PayoutStatus = ... // unchanged

export function mapProviderStatus(code: string): PayoutStatus {
  const result = sharedMapProviderStatus(code, { unknownBehavior: 'return-unknown' });
  // result can be 'unknown' or other statuses. For 'failed' result will be lowercase.
  return result as PayoutStatus;
}
```

The shared mapper may return null for unknown with 'skip', but we set 'return-unknown'.

Now reporting script:

scripts/reporting.ts currently defines its own mapProviderStatus function. We need to replace it with a call to shared mapper with appropriate options: unknownBehavior = 'skip', legacyReportCasing = true.

Thus, modify the function:

```ts
import { mapProviderStatus as sharedMapProviderStatus } from '../src/shared/payment-status-mapper.js';

export function mapProviderStatus(code: string): string | null {
  return sharedMapProviderStatus(code, { unknownBehavior: 'skip', legacyReportCasing: true });
}
```

But we need to keep imports accordingly: the script is at scripts/reporting.ts; relative path from there to src/shared is `../src/shared/payment-status-mapper.js` (since scripts folder is top-level). Use .js extension.

Now we also need to add characterization tests for reporting script mapping. Write test file: test/reporting.spec.ts.

We need to pin the current output for all statuses (including the quirk). The mapping currently maps statuses as described. So we need to write tests for each provider code that the reporting script supports. Also test unknown code returns null.

List all provider codes in union: 'PENDING','AWAITING_PAYMENT','AUTHORIZED','CAPTURED','SETTLED','REFUNDED','PARTIAL_REFUND','DECLINED','EXPIRED','CHARGEBACK','PAYOUT_SETTLED','PAYOUT_REVERSED' maybe not used by reporting script currently (they were not originally in the reporting script). But after extraction we will still map them if they are passed; however we only need to test the existing behavior for the original codes. But maybe the union includes those but reporting script didn't have them originally. The original mapping includes codes: 'PENDING','AWAITING_PAYMENT','AUTHORIZED','CAPTURED','SETTLED','REFUNDED','PARTIAL_REFUND','DECLINED','EXPIRED','CHARGEBACK'. It didn't have 'PAYOUT_SETTLED','PAYOUT_REVERSED'. We can include tests for these but they didn't exist earlier; but they are not part of original behavior, so we should not test them. The spec: "pinning its current output for all statuses (including the quirk)". So we need to cover all provider status values that the original reporting copy could see: the ones above.

Thus test file should import mapProviderStatus from scripts/reporting.ts and check expected outputs.

Also test that unknown code returns null.

Implementation:

```ts
import { describe, it, expect } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping (characterization)', () => {
  it('maps pending-like codes to "pending"', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized to "authorized"', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled-like codes to "paid"', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund-like codes to "refunded"', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps decline/expires to uppercase "FAILED"', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback to "chargeback"', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown codes', () => {
    expect(mapProviderStatus('UNKNOWN_CODE')).toBeNull();
  });
});
```

Now we need to ensure that we haven't changed the existing tests. Let's examine existing tests: orders.status.spec.ts imports mapProviderStatus from ../src/orders/orders.status.js. So after change, orders.status.ts should still export mapProviderStatus that throws for unknown. Ensure it uses shared mapper with unknownBehavior 'throw', and that unknown code throws. Good.

payouts.status.spec.ts imports mapProviderStatus from src/payouts/payouts.status.js. It tests for payout-specific settle code and reversal mapping. It also doesn't test unknown handling. However, other parts of code (PayoutsService) uses mapProviderStatus and expects unknown to map to 'unknown' (string). We must ensure that mapping for unknown returns 'unknown' and not null; the service's reconcile uses unknown status to push id to unresolved. That's already the case.

Make sure we didn't break type definitions for PayoutStatus, which includes 'unknown', 'failed', etc. That's okay.

Also the mapProviderStatus function in shared will map unknown to 'unknown' for payouts, 'skip' (null) for reporting, and throw for orders.

Now we need to create the shared file.

Now we need to update imports in orders.service.ts and payouts.service.ts? Actually orders.service.ts imports { mapProviderStatus, type OrderStatus } from './orders.status.js'; it uses mapProviderStatus. Since orders.status.ts still exports mapProviderStatus with same signature (string => OrderStatus). So we don't need to change orders.service.ts.

Similarly payouts.service.ts imports mapProviderStatus from './payouts.status.js'. That's unchanged.

Thus only need to modify the status files and reporting script, add shared mapper, and add characterization tests.

Additionally we need to create NOTES.md with documentation.

We need to ensure that the test suite includes the new test file. The repository's test runner will automatically run all tests under test folder.

Now we need to create NOTES.md file in root (or src?). The spec says create NOTES.md. Path unspecified; maybe root. We'll create at root.

Content: Document three copies, the quirk, the divergence in unknown handling.

We'll include something like:

```
# Payment status mapping notes

This repository contains three call sites that map provider status codes to internal statuses:

1. **Orders module** (`src/orders/orders.status.ts`) – base mapping used for order display.
   - Unknown provider code → throws `Error`.
   - Maps `DECLINED` / `EXPIRED` to `'failed'` (lowercase).

2. **Payouts module** (`src/payouts/payouts.status.ts`) – same base mapping plus two extra provider codes:
   - `PAYOUT_SETTLED` → `'paid'`.
   - `PAYOUT_REVERSED` → `'refunded'`.
   - Unknown provider code → returns `'unknown'` (string) to allow reconciliation to continue.

3. **Reporting script** (`scripts/reporting.ts`) – same base mapping but with a legacy CSV format quirk:
   - `DECLINED` / `EXPIRED` map to `'FAILED'` (uppercase) when `legacyReportCasing` is enabled.
   - Unknown provider code → returns `null`, causing the row to be omitted from CSV.

The shared mapper (`src/shared/payment-status-mapper.ts`) centralises the mapping logic. Each call site delegates to it with appropriate options:

- Orders: `{ unknownBehavior: 'throw' }`
- Payouts: `{ unknownBehavior: 'return-unknown' }`
- Reporting: `{ unknownBehavior: 'skip', legacyReportCasing: true }`

The divergence in unknown-code handling is intentional and documented here. Unifying these behaviours would require a coordinated change across the three consumers and their downstream integrations.

```

Now we need to add necessary import path adjustments. Ensure the paths are correct for ESM imports (with .js extension). The current files use import { mapProviderStatus, type OrderStatus } from './orders.status.js'; They have .js extension because TypeScript compiled with "module": "NodeNext" and using ESM; test files also import with .js extension.

We need to add the shared file with .ts extension; other TS files will import from '../shared/payment-status-mapper.js'.

Now modify src/orders/orders.status.ts and src/payouts/payouts.status.ts accordingly. Also ensure that imports use relative path: they are inside src/orders and src/payouts respectively; the shared file is in src/shared. So from src/orders/orders.status.ts, relative path to src/shared/payment-status-mapper.ts is `../shared/payment-status-mapper.js`. Similarly from src/payouts/payouts.status.ts: `../shared/payment-status-mapper.js`.

Potential issue: We need to add .js extension due to ESM.

Now create src/shared/payment-status-mapper.ts.

Now we need to adjust any other import that might refer to mapProviderStatus from the script's original location. The script will still have its own mapProviderStatus function but delegate; we need to import from shared.

Now after implementing, we need to run tests conceptually to ensure they pass.

Let's simulate expected outputs.

Shared mapper:

Mapping code:

- case 'PENDING', 'AWAITING_PAYMENT': return 'pending'.
- 'AUTHORIZED': return 'authorized'.
- 'CAPTURED', 'SETTLED', 'PAYOUT_SETTLED': return 'paid'.
- 'REFUNDED', 'PARTIAL_REFUND', 'PAYOUT_REVERSED': return 'refunded'.
- 'DECLINED', 'EXPIRED':
   - if legacyReportCasing: return 'FAILED' (uppercase)
   - else return 'failed'.
- 'CHARGEBACK': return 'chargeblock' (actually spelled 'chargeback')
- default: unknown behavior.

Now ensure that the string returned for legacyReportCasing is 'FAILED' uppercase; the type OrderStatus expects lowercase 'failed', but we only use that mapping in reporting script where it expects string maybe uppercase; we just use mapProviderStatus with that option. So it will return uppercase 'FAILED'.

Potential conflict: The shared mapper also returns 'FAILED' uppercase only when legacyReportCasing true, else 'failed' lower-case. For orders and payouts unknown default, we set legacyReportCasing false, so they get lowercase.

Now for orders status tests:

Orders test expects mapProviderStatus('CAPTURED') returns 'paid'. That passes. Also mapProviderStatus('REFUNDED') returns 'refunded'. Unknown code throws.

Our orders.status.ts wrapper will call sharedMapProviderStatus('CAPTURED', { unknownBehavior: 'throw' }). That will return 'paid'. Good.

But we must also ensure that the wrapper returns the correct type; using type cast.

Now unknown code: sharedMapProviderStatus('WHATEVER', { unknownBehavior: 'throw' }) will go to default case and throw. So wrapper will also throw.

Now payout status tests: they only test payout-specific settle and reversal codes mapping to 'paid' and 'refunded' respectively. Our wrapper will call sharedMapProviderStatus('PAYOUT_SETTLED', { unknownBehavior: 'return-unknown' }). That will return 'paid'. Good. For 'PAYOUT_REVERSED' returns 'refunded'.

Now other code in payouts.service: It uses mapProviderStatus and expects return type PayoutStatus. It may also receive unknown provider codes from records; unknown should map to 'unknown' (string). The shared mapper with unknownBehavior 'return-unknown' returns 'unknown'. Good.

Now reporting script's mapProviderStatus function will call sharedMapProviderStatus(code, { unknownBehavior: 'skip', legacyReportCasing: true }). For 'DECLINED' returns 'FAILED', for 'CAPTURED' returns 'paid', for unknown returns null. Works.

Now test for unknown in reporting spec expects null. Good.

Now we also need to consider that the reporting script's buildRows function uses mapProviderStatus(p.providerStatus). It expects mapProviderStatus returns string or null; we changed it to delegate to shared mapper and returns string | null. So no issues.

Potential additional imports: script imports { mapProviderStatus } from '../src/shared/payment-status-mapper.js', but script is at root/scripts/reporting.ts. The path relative: `../src/shared/payment-status-mapper.js`. Yes.

Now we also need to adjust tsconfig include path for src/shared. Already includes src/**/*.ts.

Now we need to ensure no leftover mapProviderStatus definitions cause duplicate definitions (e.g., in orders.status.ts still defines function but now delegates). That's fine.

Now we need to ensure we added .js extension correctly for import statements in TypeScript files. In ESM NodeNext, when you import a TS file, you need .js extension at runtime; but TypeScript compiler allows using .js because it will compile to .js. In current code they use .js extension for imports of .ts modules. So we follow that.

Now we need to implement src/shared/payment-status-mapper.ts with .ts extension. In its export, we need to ensure we use `export` properly.

Now also need to adjust import path for the new file if used in test; tests import from script that uses .js extension.

Now run through tests:

Test files:

- test/orders.status.spec.ts imports { mapProviderStatus } from '../src/orders/orders.status.js'; that file uses import from shared as we wrote; that import path will be relative to src/orders. Implementation will compile.

- test/payouts.status.spec.ts imports { mapProviderStatus } from '../src/payouts/payouts.status.js'; wrapper uses shared.

- test/reporting.spec.ts imports from '../scripts/reporting.js'; that file uses shared.

Potential issues: The new file src/shared/payment-status-mapper.ts may not have a .js extension; but imports from .js compile fine because TS will compile to .js. The .js extension in import path indicates the module name after compilation. So we should import using .js.

Now need to think about TypeScript compile with "moduleResolution": "NodeNext" and "module": "NodeNext". This means .ts files compile to .js, and import paths must include extensions for .js (or .ts if you use ts-node?). In the repository they used imports like './orders.status.js', which is a .js file in the compiled output but referencing .ts source. So we follow same pattern.

Thus modify src/orders/orders.status.ts line: import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js'; But the current file uses relative path './orders.status.ts' inside src/orders; to go to src/shared, path is `../shared/payment-status-mapper.js`. The orders/status file is located at src/orders/orders.status.ts; the relative path to src/shared is `../shared/payment-status-mapper.js`. Good.

Similarly for payouts.

Now test for orders throws unknown: mapProviderStatus('WHATEVER') => shared mapper throws. Good.

Potential nuance: In shared mapper, default unknownBehavior is 'throw'. For orders wrapper we set unknownBehavior: 'throw' explicitly. However we also need to pass no other options (legacyReportCasing false). Good.

Now implement wrappers.

Potential nuance: The return type for orders wrapper is OrderStatus which includes 'failed', not 'FAILED'. Shared mapper returns either 'failed' (lowercase) or 'FAILED' if legacyReportCasing true; but we call it without that option, so we get lowercase 'failed'.

Now for payouts wrapper: return type includes 'unknown', 'failed', etc. We call with unknownBehavior: 'return-unknown', so unknown returns 'unknown', else lowercase statuses.

Now ensure that for unknown code with options 'return-unknown', we return 'unknown' string; this is part of PayoutStatus union. Good.

Now ensure that the shared mapper's return type includes 'unknown' as a possible status. So we need to include it in the union: PaymentStatus type we defined includes 'unknown'.

Now need to add JSDoc comment perhaps.

Now add the new test file.

Now create NOTES.md.

Now final check: All test files import .js extension; after we modify code, they will still work.

Now also need to ensure that any other code that uses mapProviderStatus function directly (e.g., buildRows uses mapProviderStatus from reporting script). The script now uses shared mapper; fine.

Potential issues: The import path in reporting script may be relative to the root, e.g., `../src/shared/payment-status-mapper.js`. That path goes up one level (scripts to root, then src) then shared folder. So correct.

Now we need to ensure the repo root includes a src/shared folder; we will create src/shared/payment-status-mapper.ts.

Now test for unknown code in reporting returns null; mapping unknown with unknownBehavior: 'skip' returns null (explicit) and not 'unknown'.

Now check that the reporting script also used legacyReportCasing option. The original mapping returns uppercase for DECLINED/EXPIRED; we preserve via that.

Now confirm that the mapProviderStatus function returns string or null for reporting; we have `return sharedMapProviderStatus(...);` which returns string | null. Good.

Now we need to ensure the wrapper functions have appropriate TypeScript types for return (string | null) for script; the wrapper's signature is `export function mapProviderStatus(code: string): string | null` as before. Good.

Now after modifications, the tests should pass.

Potential edge: The orders.status.ts wrapper returns result as OrderStatus. But the shared mapper returns string | null; in case unknown throws, result won't be assigned. For known codes, result will be string. Should we handle case where result is null (should never happen) but we can cast. That's okay.

Now we also need to add proper export for PaymentStatusMapper (function) maybe also create a class? The spec says "PaymentStatusMapper". Could be class. But we can provide a function; but the name might need to be PaymentStatusMapper. The spec: "Extract a single PaymentStatusMapper into src/shared/". Possibly they expect a class named PaymentStatusMapper. But we can implement as a class with static method, or a function exported with that name. But they said "PaymentStatusMapper". It's ambiguous. For clarity, we can export a class `PaymentStatusMapper` with static method `mapProviderStatus`. Or we can just export function `mapProviderStatus`. But the spec uses "PaymentStatusMapper" as the concept, not necessarily a class. The earlier tasks often expect the file to be named `payment-status-mapper.ts` and export a function; they might be okay.

But we need to match "Extract a single `PaymentStatusMapper` into `src/shared/`". That suggests a file named `payment-status-mapper.ts` that maybe exports a class or a function. Could be exported as default maybe. But we have to make sure we keep usage consistent: wrappers import `mapProviderStatus as sharedMapProviderStatus` from shared file. That is fine.

Potential risk: The code may not compile if we try to import a function that doesn't exist or not exported. We'll ensure we export both the function and types from that file.

Thus file src/shared/payment-status-mapper.ts:

```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback' | 'unknown';

export interface PaymentStatusMapperOptions {
  /** 
   * Determines what to do with a provider status that is not recognized.
   *
   * - `'throw'` – throws an Error (default for the orders module).
   * - `'return-unknown'` – returns the string `'unknown'` (payouts module).
   * - `'skip'` – returns `null`, signalling the caller to ignore the value
   *   (reporting script).
   */
  unknownBehavior?: 'throw' | 'return-unknown' | 'skip';
  /** 
   * When true, the status `'failed'` is returned as uppercase `'FAILED'`.
   *
   * This matches the historic CSV format used by the finance team.
   */
  legacyReportCasing?: boolean;
}

/**
 * Maps a provider status code to an internal payment status.
 *
 * @param code Provider status string.
 * @param options Mapping options.
 * @returns The mapped status string, or `null` if `unknownBehavior` is `'skip'`.
 *
 * @throws When `unknownBehavior` is `'throw'` and `code` is not known.
 */
export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {}
): string | null {
  const { unknownBehavior = 'throw', legacyReportCasing = false } = options;

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
      // Base status is 'failed'; apply legacy casing if requested.
      if (legacyReportCasing) {
        return 'FAILED';
      }
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      // Unknown provider status
      if (unknownBehavior === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      if (unknownBehavior === 'return-unknown') {
        return 'unknown';
      }
      // 'skip' or any other value – return null to let caller ignore.
      return null;
  }
}
```

Now modify src/orders/orders.status.ts:

```ts
import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

export type OrderStatus = 
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  // For orders we want the default behaviour: throw on unknown,
  // and normal (lowercase) failed status.
  const result = sharedMapProviderStatus(code, { unknownBehavior: 'throw' });
  // result cannot be null; cast to OrderStatus.
  return result as OrderStatus;
}
```

Now modify src/payouts/payouts.status.ts:

```ts
import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  // For payouts we want unknown codes to map to 'unknown'.
  const result = sharedMapProviderStatus(code, { unknownBehavior: 'return-unknown' });
  // result cannot be null; cast.
  return result as PayoutStatus;
}
```

Now modify scripts/reporting.ts:

```ts
import { mapProviderStatus as sharedMapProviderStatus } from '../src/shared/payment-status-mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

// Map provider status to CSV column value.
// Legacy behaviour: 'DECLINED'/'EXPIRED' map to uppercase 'FAILED'.
// Unknown codes are skipped (return null).
export function mapProviderStatus(code: string): string | null {
  return sharedMapProviderStatus(code, {
    unknownBehavior: 'skip',
    legacyReportCasing: true,
  });
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

Now add test file.

Now create NOTES.md.

Now verify that any relative imports have correct path.

- In src/orders/orders.status.ts, path `../shared/payment-status-mapper.js`. Since file is src/orders/orders.status.ts, going up one level to src, then into shared. Correct.

- In src/payouts/payouts.status.ts, same.

- In scripts/reporting.ts, path `../src/shared/payment-status-mapper.js` (scripts folder at root, goes up to root, then src/shared). Good.

Now check that `src/shared/payment-status-mapper.ts` is within tsconfig include.

Now run through tests manually.

**orders.status.spec.ts**:

```ts
import { mapProviderStatus } from '../src/orders/orders.status.js';

describe('orders status mapping', () => {
  it('maps the settled codes to paid', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });
  // ...
});
```

Now mapProviderStatus('CAPTURED') in orders.status wrapper:

- Calls sharedMapProviderStatus('CAPTURED', { unknownBehavior: 'throw' })
- In shared mapper: case matches 'CAPTURED' -> returns 'paid'.
- result cast to OrderStatus -> 'paid'. Expect passes.

Now mapProviderStatus('SETTLED') returns 'paid'.

Second test for refund codes: 'REFUNDED' => returns 'refunded'.

Third test unknown code: mapProviderStatus('WHATEVER') => sharedMapProviderStatus throws. The wrapper just returns result (which never returns). So throws; test expects toThrow. Pass.

Now payouts.status.spec.ts:

```ts
import { mapProviderStatus } from '../src/payouts/payouts.status.js';

describe('payouts status mapping', () => {
  it('treats the payout-specific settle code as paid', () => {
    expect(mapProviderStatus('PAYOUT_SETTLED')).toBe('paid');
  });

  it('treats a reversal as a refund', () => {
    expect(mapProviderStatus('PAYOUT_REVERSED')).toBe('refunded');
  });
});
```

Now wrapper calls sharedMapProviderStatus('PAYOUT_SETTLED', unknownBehavior: 'return-unknown') -> returns 'paid'.

Second test returns 'refunded'.

All good.

Now test/reporting.spec.ts (characterization) expects certain outputs. Let's verify.

Case 'PENDING': sharedMapProviderStatus('PENDING', { unknownBehavior: 'skip', legacyReportCasing: true }). Returns 'pending'. Good.

'AWAITING_PAYMENT': same.

'AUTHORIZED': 'authorized'.

'CAPTURED', 'SETTLED' -> 'paid'.

'REFUNDED','PARTIAL_REFUND' -> 'refunded'.

'DECLINED','EXPIRED': case matches; legacyReportCasing true => returns 'FAILED'.

'CHARGEBACK' => 'chargeback'.

Unknown => default case, unknownBehavior 'skip' -> returns null. Good.

Now test for unknown returns null.

All should pass.

Now confirm that the test import path for reporting uses .js extension. It will import compiled file. In TypeScript source, we have to add export at top level with .js extension; our script imports shared mapper. That's fine.

Now check the build script for other code using mapProviderStatus directly (maybe not). Only three places.

Now verify any other file may still import mapProviderStatus directly from shared? None.

Potential errors: Path imports need to be relative to compiled JS location (which will be same as source path). But since NodeNext uses .js extension and source files are .ts, they are compiled to .js but still in the same relative location. At runtime, when test imports compiled .js files (via ts-node? Vitest uses ts-node/tsx to transpile on the fly). It resolves .js imports to .ts source file? Vitest uses ts-node's ESM support that maps .js imports to .ts files. This works as before. So our imports will work.

Potential error: In src/orders/orders.status.ts we imported from '../shared/payment-status-mapper.js' but the actual file is src/shared/payment-status-mapper.ts. The path from src/orders to src/shared is `../shared`. In the original code, there is no shared folder. So we must ensure the folder is created.

Now need to add test files. The new test file must be in test folder.

Now create NOTES.md.

Now final step: ensure that there are no other imports referencing orders.status or payouts.status that need to import changed path. No.

Now ensure that the code passes type-checking.

Potential type errors: In src/orders/orders.status.ts, we imported `mapProviderStatus as sharedMapProviderStatus` which returns `string | null`. The wrapper expects OrderStatus (string union). The casting may be okay but we should handle the null case. However TypeScript may error because `result` type is `string | null`. We cast to OrderStatus, but there is still potential that it's null. TypeScript may allow casting with `as OrderStatus` but it may complain about possibly null? Usually casting with `as` will just coerce; no error. But we may need to do an assert that result is not null.

Similarly in payouts wrapper.

Now check for any other code that expects mapProviderStatus to be type safe. In orders.service.ts, they use mapProviderStatus(record.providerStatus) and assign to status: OrderStatus. That's fine.

In payouts.service.ts, they use mapProviderStatus(r.providerStatus) to assign to status: PayoutStatus. That's fine.

Now check for any other usage like import statements that rely on mapProviderStatus return type; not needed.

Now we need to ensure that the test for reporting script also imports mapProviderStatus from scripts/reporting.js; but that file now exports mapProviderStatus as described.

All good.

Now we need to provide the final solution with all files.

List of files to be provided:

- src/shared/payment-status-mapper.ts (new)
- src/orders/orders.status.ts (modified)
- src/payouts/payouts.status.ts (modified)
- scripts/reporting.ts (modified)
- test/reporting.spec.ts (new)
- NOTES.md (new)

Potentially need to adjust import paths for relative location. We must double-check paths:

- src/orders/orders.status.ts: located at src/orders/orders.status.ts, relative import to shared file: `../shared/payment-status-mapper.js`. The file is src/shared/payment-status-mapper.ts. So `../shared/payment-status-mapper.js` is correct.

- src/payouts/payouts.status.ts: located at src/payouts/payouts.status.ts, relative import to shared file: `../shared/payment-status-mapper.js`. The file path is also src/shared. So also correct.

- scripts/reporting.ts: located at scripts/reporting.ts, relative import path: `../src/shared/payment-status-mapper.js`. The file is src/shared/payment-status-mapper.ts, so go up from scripts to root, then src/shared. Yes.

Potential nuance: In TypeScript modules under src/, they import using relative path with `../shared/payment-status-mapper.js`. However the code is compiled with ESM module resolution NodeNext; the relative path should be from compiled JS file, which will be same directory as .ts file. So fine.

Now ensure that the tsconfig's include includes src/shared/*.ts. Already includes src/**/*.ts.

Now check for any other imports of mapProviderStatus in other files: there is import in src/orders/orders.service.ts that imports from './orders.status.js'. That's still unchanged.

Now we need to ensure that we didn't inadvertently create duplicate exported mapProviderStatus function names causing import collisions. That's fine.

Now implement the new test file test/reporting.spec.ts with proper imports. Use .js extension.

Now implement NOTES.md content.

Now we should deliver each file with heading and fenced block.

Now final answer.

Potential missing modifications: Might need to adjust the script's import path to use relative path starting with `./src/shared`? Actually scripts folder is at root, sibling to src folder. The relative path to src/shared from scripts folder is `../src/shared/payment-status-mapper.js`. Confirm: root folder contains src/ and scripts/. If you're in scripts/reporting.ts, you go up to root (..), then src, then shared. So `../src/shared/payment-status-mapper.js` is correct.

Now final answer includes all the files.

Potential edge-case: The wrapper files might need to import type for unknown behavior; not needed.

Now final answer includes 6 files.

We also need to ensure we didn't inadvertently break other tests. Let's run through everything.

### Pre-existing code

- src/orders/orders.service.ts: imports mapProviderStatus from './orders.status.js' and uses it. Works.

- src/payouts/payouts.service.ts: uses mapProviderStatus.

Now check that the wrapper function mapProviderStatus signature matches type definitions.

- In src/orders/orders.status.ts: we need to export type OrderStatus (unchanged) and function mapProviderStatus returning OrderStatus.

Our wrapper will return result as OrderStatus, but the type PaymentStatus includes 'unknown', 'failed', etc. But result will be string; if unknown code, the shared mapper throws. So we never get null or 'unknown'.

Potential compile error: The return type is OrderStatus, which does not include 'unknown' nor uppercase 'FAILED'. The wrapper is typed accordingly.

Now check that the function signature is `function mapProviderStatus(code: string): OrderStatus`. So returning `result as OrderStatus` is okay.

Potential compile error: The `as OrderStatus` cast may be unsound for unknown codes but it's okay.

Now for src/payouts/payouts.status.ts: wrapper returns result as PayoutStatus; but `result` could be null if unknownBehavior 'return-unknown' returns 'unknown'? Actually shared mapper will return 'unknown' for unknown codes. Not null. So result is string; cast to PayoutStatus works as 'unknown' is part of PayoutStatus.

Now test for unknown behavior not covered but fine.

Now for script: wrapper signature returns string | null. The shared mapper returns string | null; that matches.

Now we need to ensure that the script's mapProviderStatus function's JSDoc comment says "legacyReportCasing: true". That's done.

Now we need to think about test runner's path resolution for imports. In test/reporting.spec.ts we do `import { mapProviderStatus } from '../scripts/reporting.js';` Since test file is in test folder, relative path to scripts folder is `../scripts/reporting.js`. That matches existing pattern.

Now we need to confirm that the test file uses `.js` extension. In other tests they use .js for imports (e.g., test/orders.status.spec.ts imports '../src/orders/orders.status.js'), which is relative from test folder.

Thus `../scripts/reporting.js` is correct.

Now check that there is no other file referencing 'PaymentStatusMapper' name; not needed.

Now final answer includes all required files.

Potential nuance: The spec says deliver every file the solution needs, complete, first line to last. So we must output each file fully with content, not partial.

Thus final answer will be:

```
### src/shared/payment-status-mapper.ts
```ts
...content...
```

...

And so on.

Now generate final answer.
```

## reply

### src/shared/payment-status-mapper.ts
```ts
/**
 * Centralised mapping of provider status codes to internal payment statuses.
 *
 * The mapper is used by three distinct call‑sites (orders, payouts, reporting)
 * which each require slightly different behaviour for unknown codes and for a
 * legacy CSV quirk. The mapper’s options allow each consumer to specify the
 * required contract while keeping the actual mapping logic in one place.
 */
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export interface PaymentStatusMapperOptions {
  /**
   * Determines how to handle a provider status that is not recognised.
   *
   * - `'throw'` – throws an `Error` (default for the orders module).
   * - `'return-unknown'` – returns the string `'unknown'` (payouts module).
   * - `'skip'` – returns `null`, signalling the caller to ignore the value
   *   (reporting script).
   */
  unknownBehavior?: 'throw' | 'return-unknown' | 'skip';
  /**
   * When true, the status `'failed'` is returned as uppercase `'FAILED'`.
   *
   * This matches the historic CSV format used by the finance team and is
   * required only by the reporting script.
   */
  legacyReportCasing?: boolean;
}

/**
 * Maps a provider status code to an internal payment status.
 *
 * @param code    Provider status string.
 * @param options Mapping options.
 *
 * @returns The mapped status string, or `null` if `unknownBehavior` is `'skip'`.
 *
 * @throws When `unknownBehavior` is `'throw'` and `code` is not known.
 */
export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {}
): string | null {
  const { unknownBehavior = 'throw', legacyReportCasing = false } = options;

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
      // Base status is 'failed'; apply legacy casing if requested.
      if (legacyReportCasing) {
        return 'FAILED';
      }
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      // Unknown provider status.
      if (unknownBehavior === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      if (unknownBehavior === 'return-unknown') {
        return 'unknown';
      }
      // 'skip' or any other value – return null so the caller can ignore.
      return null;
  }
}
```

### src/orders/orders.status.ts
```ts
import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

// Provider status -> internal status, for the order detail screen.
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/**
 * Wrapper around the shared mapper for the orders module.
 *
 * - Unknown provider codes throw (default behaviour of the shared mapper).
 * - No legacy CSV casing is applied.
 */
export function mapProviderStatus(code: string): OrderStatus {
  const result = sharedMapProviderStatus(code, { unknownBehavior: 'throw' });
  // The shared mapper never returns `null` when `unknownBehavior` is `'throw'`.
  return result as OrderStatus;
}
```

### src/payouts/payouts.status.ts
```ts
import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

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

/**
 * Wrapper around the shared mapper for the payouts module.
 *
 * - Unknown provider codes map to the string `'unknown'` (required for
 *   reconciliation to continue).
 * - No legacy CSV casing is applied.
 */
export function mapProviderStatus(code: string): PayoutStatus {
  const result = sharedMapProviderStatus(code, { unknownBehavior: 'return-unknown' });
  // The shared mapper never returns `null` when `unknownBehavior` is
  // `'return-unknown'`.
  return result as PayoutStatus;
}
```

### scripts/reporting.ts
```ts
import { mapProviderStatus as sharedMapProviderStatus } from '../src/shared/payment-status-mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

/**
 * Map provider status to the CSV column value used by the finance team.
 *
 * Legacy quirk: `DECLINED` / `EXPIRED` map to uppercase `'FAILED'`.
 * Unknown provider codes are silently skipped (return `null`).
 */
export function mapProviderStatus(code: string): string | null {
  return sharedMapProviderStatus(code, {
    unknownBehavior: 'skip',
    legacyReportCasing: true,
  });
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

### test/reporting.spec.ts
```ts
import { describe, it, expect } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping (characterization)', () => {
  it('maps pending‑like codes to "pending"', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized to "authorized"', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled‑like codes to "paid"', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund‑like codes to "refunded"', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps decline/expires to uppercase "FAILED"', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback to "chargeback"', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown provider codes', () => {
    expect(mapProviderStatus('UNKNOWN_CODE')).toBeNull();
  });
});
```

### NOTES.md
```md
# Payment status mapping – notes

The repository contains three call‑sites that map provider status codes to
internal payment statuses:

1. **Orders module** – `src/orders/orders.status.ts`  
   *Purpose*: Base mapping for the order detail screen.  
   *Behaviour*:
   - Unknown provider codes **throw** an `Error`.
   - `DECLINED` / `EXPIRED` map to `'failed'` (lower‑case).

2. **Payouts module** – `src/payouts/payouts.status.ts`  
   *Purpose*: Mapping for payout reconciliation, with two extra provider codes.  
   *Behaviour*:
   - Unknown provider codes return the string `'unknown'` (so reconciliation can
     continue).
   - `DECLINED` / `EXPIRED` map to `'failed'` (lower‑case).

3. **Reporting script** – `scripts/reporting.ts`  
   *Purpose*: Generates nightly CSVs consumed by the finance team.  
   *Behaviour*:
   - `DECLINED` / `EXPIRED` map to **uppercase** `'FAILED'` – a legacy quirk
     required by downstream spreadsheets.
   - Unknown provider codes return `null`; the row is omitted from the CSV.

## Extraction

All three call‑sites now delegate to a single **PaymentStatusMapper** located at
`src/shared/payment-status-mapper.ts`.  The mapper contains the exhaustive
provider‑to‑internal status table and exposes an options object that lets each
consumer specify:

- `unknownBehavior`: `'throw' | 'return-unknown' | 'skip'`
- `legacyReportCasing`: `boolean`

The wrappers in the three original modules forward the appropriate options,
preserving the existing contracts.

## Deliberate divergence

The handling of *unknown* provider codes is intentionally **different** across
the three consumers:

| Consumer | `unknownBehavior` | Result |
|----------|-------------------|--------|
| Orders   | `'throw'`         | `Error` is thrown |
| Payouts  | `'return-unknown'`| Returns `'unknown'` (string) |
| Reporting| `'skip'`          | Returns `null` (row is skipped) |

Changing any of these behaviours would affect downstream logic (e.g. the
reconciliation process or the finance CSV), so the divergence is documented
here. Unifying the behaviour should only be done after a coordinated change
and a full impact assessment.

---  

*The extraction, the new `legacyReportCasing` option, and the characterization
tests for the reporting script ensure that the observable behaviour of the
system remains unchanged.*
