# solution

## reasoning

```
We need to implement extraction of payment status mapping into a shared mapper. We have three code sections:

- src/orders/orders.status.ts: defines mapProviderStatus for orders (returns OrderStatus, throws on unknown).
- src/payouts/payouts.status.ts: defines mapProviderStatus for payouts (returns PayoutStatus, returns 'unknown' on default).
- scripts/reporting.ts: defines mapProviderStatus for reporting (returns string | null, returns null on unknown and also does quirk: for DECLINED/EXPIRED it returns 'FAILED' (uppercase) rather than 'failed', also returns null for unknown).

Goal:

1. Write characterization tests for reporting copy (script/reporting.ts) first, before moving anything. Tests should pin current output for each provider status code, including the quirk.

2. Extract a PaymentStatusMapper into src/shared/. The mapper must cover the union of provider codes across all three call sites, i.e., all codes seen in orders, payouts, and reporting.

3. Provide mapping function(s) that handle the different behaviors.

Given divergence on unknown codes: orders should throw; payouts should return 'unknown'; reporting should return null (skip). We need to preserve this divergence via the mapper's API. So we need a unified mapper that can be configured per caller, maybe via options controlling unknown handling and legacyReportCasing. Something like:

export type PaymentStatus = 'pending'|'authorized'|'paid'|'refunded'|'failed'|'chargeback'|'unknown'? Wait: 'unknown' is only for payouts. So the generic mapping returns a type union that includes 'unknown'? Or the function can return string, but the caller can decide.

But we also need to preserve type safety for each call site. In orders, mapProviderStatus returns OrderStatus which does not include 'unknown'. In payouts, it returns PayoutStatus which includes 'unknown'.

We need to modify orders and payouts to call the new shared mapper, passing appropriate options to get appropriate behavior. This includes unknown handling and maybe inclusion of extra codes (PAYOUT_SETTLED and PAYOUT_REVERSED). However, we can make the shared mapper aware of these extra codes, but mapping to 'paid' and 'refunded', but for orders, unknown code should cause thrown error, and also they don't know about those extra codes; if they get them, they should throw (same unknown handling). So the shared mapper should include all provider codes (including PAYOUT_SETTLED, PAYOUT_REVERSED). For orders, those are unknown codes and will be caught by unknown handling option (throw). For payouts, those codes map to 'paid'/'refunded' and unknown handling returns 'unknown'.

The reporting copy also maps some codes, includes the same base mapping but with special uppercase for DECLINED/EXPIRED (return 'FAILED'), and returns null for unknown (skip). Also, the reporting mapping includes same mapping for other codes, returning lowercase strings (like 'pending', 'authorized', 'paid', etc). It does not include PAYOUT_SETTLED or PAYOUT_REVERSED codes, but they could be present but not used. To preserve behavior we need to include mapping for them (the union). The reporting should treat them as per original mapping? Not sure: the original reporting script doesn't have cases for PAYOUT_SETTLED and PAYOUT_REVERSED, so they would fall to default (return null). So reporting's unknown handling is skip (null). That matches unknown behavior.

Thus, we can define a shared mapper with a function:

export interface PaymentStatusMapperOptions {
  /** If true, unknown codes return null (skip). If false, unknown returns 'unknown' for payouts or throws for orders? Actually need per-caller behavior. So perhaps we provide unknown handling via a policy: 'throw' | 'unknown' | 'skip' */
  unknown?: 'throw' | 'unknown' | 'skip';
  /** For legacyReportCasing, if true, certain statuses (DECLINED/EXPIRED) return uppercase 'FAILED' */
  legacyReportCasing?: boolean;
}

/** Returns a string representing internal status, or null for skip. */
export function mapProviderStatus(code: string, options?: PaymentStatusMapperOptions): string | null

The return type should be string | null. For orders, we want to return a value of type OrderStatus (string) but not null; we also need to throw on unknown. For payouts, we want to return a value that may be 'unknown', and never null; unknown handling returns 'unknown'. For reporting, we want to return null for unknown.

Hence the mapper can return string | null; the callers will handle null or unknown accordingly.

But order's mapProviderStatus returns OrderStatus (not nullable) and throws for unknown. We can adapt orders module to call the mapper with unknown: 'throw', then after mapping we need to cast to OrderStatus (the union includes all statuses: pending, authorized, paid, refunded, failed, chargeback). The mapper's return should be typed as string (maybe 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback' | 'unknown' (maybe). But we could make the return type generic based on options.

Better to define a generic type: PaymentStatus = ... but we need to keep original type definitions.

Approach:

- Add src/shared/payment-status-mapper.ts with:

export type InternalPaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';

export type PayoutPaymentStatus = InternalPaymentStatus | 'unknown';

export interface PaymentStatusMapperOptions {
  /** Determines handling of unknown provider codes:
   * - 'throw': throws an Error.
   * - 'unknown': returns 'unknown' (only for payouts).
   * - 'skip': returns null (only for reporting).
   */
  unknown?: 'throw' | 'unknown' | 'skip';
  /** When true, legacy report casing: for provider statuses DECLINED and EXPIRED, returns 'FAILED' instead of 'failed'. */
  legacyReportCasing?: boolean;
}

/** Map provider status code to internal status.
 * @param code provider status code
 * @param options options
 * @returns internal status string (as defined above) or null if skipped.
 * @throws if unknown handling is 'throw' and code is unrecognized.
 */
export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {}
): string | null {
  // Map known codes to internal status, ignoring options.
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
      // Apply legacy report casing if requested
      if (options.legacyReportCasing) {
        return 'FAILED';
      }
      return 'failed';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      // Unknown code handling
      if (options.unknown === 'skip') {
        return null;
      } else if (options.unknown === 'unknown') {
        return 'unknown';
      } else {
        // default to throw
        throw new Error(`unknown provider status: ${code}`);
      }
  }
}

Now adjust orders code:

- src/orders/orders.status.ts will be replaced by a wrapper that imports shared mapper, but we must keep the file (since tests import mapProviderStatus from orders/status). We can either modify orders/orders.status.ts to re-export a specialized wrapper function.

Given the instruction: "extract a single PaymentStatusMapper into src/shared/, covering the union of provider codes; the three call sites delegate to it." So each call site should delegate to the shared mapper. So we should modify orders/orders.status.ts to import shared mapper and provide its own mapProviderStatus that calls shared with unknown: 'throw', and no legacyReportCasing. Also adjust type export accordingly.

Similarly modify payouts/payouts.status.ts to import shared mapper and provide its own mapProviderStatus that passes unknown: 'unknown'.

Also need to adjust script/reporting.ts to import shared mapper with options {legacyReportCasing:true, unknown:'skip'} (default unknown handling is maybe 'skip' but we pass explicitly).

Also need to write characterization tests for reporting copy (script/reporting). This should test the mapping for all provider codes: the union? But the spec says "characterization tests for the reporting copy first, pinning its current output for all statuses (including the quirk)." So we need tests for each status that the original reporting script maps, and also test unknown code returns null (skip). The original mapping returns null for unknown codes. It also returns 'FAILED' (uppercase) for DECLINED and EXPIRED. It returns 'pending', 'authorized', 'paid', 'refunded', 'chargeback'.

Also original mapping returns null for any code not covered, e.g., 'PAYOUT_SETTLED', 'WHATEVER'.

So we can write tests covering these.

Where to put tests? The repo currently has test folder for orders and payouts. So we can add test/reporting.spec.ts (or something) with characterization tests.

Implementation details:

- We need to import mapProviderStatus from scripts/reporting.ts? The function is defined there. But after we refactor it to delegate to shared mapper, we still need to test the behavior of mapProviderStatus in reporting script. But we also need to test that the mapping includes the behavior. Since we will modify scripts/reporting.ts to delegate to shared mapper, we can test the function there. So test file path: test/reporting.spec.ts (any location). We'll import from '../src/scripts/reporting'? Actually the script is at scripts/reporting.ts. In the tsconfig, include includes scripts/**/*.ts. So test can import from '../../scripts/reporting.js' path? In test files they use relative imports like import { mapProviderStatus } from '../src/orders/orders.status.js'. That's relative to test folder. For test/reporting.spec.ts, we can import from '../scripts/reporting.js'? But test folder is at test folder; so path would be '../scripts/reporting.js' given test file in test folder and scripts folder at root level. Let's check: test folder is at test/. In test files they do import from '../src/...'. So the test file is test/reporting.spec.ts; relative path to scripts/reporting.ts is '../scripts/reporting.js'. Yes.

Thus test file:

import { describe, expect, it } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping', () => {
  it('maps pending codes to pending', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized to authorized', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled codes to paid', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund codes to refunded', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps declined and expired to FAILED (uppercase) per legacy report casing', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback to chargeback', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown provider code', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
    expect(mapProviderStatus('PAYOUT_SETTLED')).toBeNull(); // unknown in this context
  });
});

Potentially also test that mapProviderStatus returns null for other unknown. That covers characterization.

Now modify scripts/reporting.ts to delegate to shared mapper.

Currently script:

export interface ReportRow { ... }
export function mapProviderStatus(code: string): string | null { switch... }

We'll change mapProviderStatus to call the shared mapper with appropriate options: legacyReportCasing: true, unknown: 'skip'.

Thus:

import { mapProviderStatus as sharedMapProviderStatus } from '../src/shared/payment-status-mapper.js';

export function mapProviderStatus(code: string): string | null {
  return sharedMapProviderStatus(code, { legacyReportCasing: true, unknown: 'skip' });
}

Note: The path: scripts/reporting.ts is at root scripts folder; shared mapper is in src/shared/payment-status-mapper.ts. So import path is '../src/shared/payment-status-mapper.js' (relative from scripts folder). In Node ESM with .js extension for compiled code. The existing imports use .js after .ts compiled output; they do .js extensions: e.g., import { mapProviderStatus, type OrderStatus } from './orders.status.js'; So we follow same pattern.

Now we need to adjust src/orders/orders.status.ts to delegate.

Current file:

// Provider status -> internal status, for the order detail screen.
export type OrderStatus = ... ; // same as before.

export function mapProviderStatus(code: string): OrderStatus {
  switch...
}

We need to preserve type OrderStatus. So we can keep the type definition unchanged. But function should call shared mapper with unknown: 'throw', and return the result as OrderStatus.

Thus:

import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

export type OrderStatus = ... (same)

export function mapProviderStatus(code: string): OrderStatus {
  const result = sharedMapProviderStatus(code, { unknown: 'throw' });
  // Since result is string, but TypeScript may think it could be null or 'unknown'.
  // We need to cast.
  // But unknown handling 'throw' will never return null or 'unknown' but will throw if unknown. So result type is string.
  // Use as OrderStatus.
  return result as OrderStatus;
}

But we need to ensure TypeScript's type inference: sharedMapProviderStatus returns string | null, but we specify unknown: 'throw', which returns string (not null). However TypeScript doesn't know that; we might need to assert.

Alternatively we could overload sharedMapProviderStatus for unknown: 'throw' returning string.

Simplify: we just cast.

Now modify src/payouts/payouts.status.ts.

Current file defines PayoutStatus type with 'unknown' included. It also defines mapProviderStatus that returns PayoutStatus and default returns 'unknown'.

We need to delegate to shared mapper with unknown: 'unknown' and without legacyReportCasing (default false). That will return string (status) or 'unknown' as string.

Thus:

import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

export type PayoutStatus = ... (includes 'unknown').

export function mapProviderStatus(code: string): PayoutStatus {
  const result = sharedMapProviderStatus(code, { unknown: 'unknown' });
  // result can be null? unknown: 'unknown' ensures unknown returns 'unknown', not null. But there is possibility of null if code unknown and unknown handling is 'unknown'? Our mapper returns 'unknown' for default case. So result won't be null. So cast.

  return result as PayoutStatus;
}

Now we need to ensure mapping includes 'PAYOUT_SETTLED' => 'paid' and 'PAYOUT_REVERSED' => 'refunded' in shared mapper. Yes we added those.

Now adjust the imports in payouts service and orders service remain same—they import from './payouts.status.js', which still defines mapProviderStatus.

Now add the new shared mapper file: src/shared/payment-status-mapper.ts.

Write file accordingly.

Also create NOTES.md at root, describing the three copies, the quirk, and deliberate divergence.

Now we must ensure all test files still pass: orders status spec and payouts status spec. The tests expect certain behavior: orders.status.spec tests that mapProviderStatus('CAPTURED') returns 'paid', 'REFUNDED' => 'refunded', and throws on unknown code. Should still pass.

payouts.status.spec tests that 'PAYOUT_SETTLED' => 'paid', 'PAYOUT_REVERSED' => 'refunded'. Should still pass.

We need to ensure the imports in tests still work. They import mapProviderStatus from '../src/payouts/payouts.status.js', which still exports the function. So okay.

Now we have added new test for reporting.

Now we must ensure that the code compiles. Let's verify type signatures.

Create src/shared/payment-status-mapper.ts.

Define:

export type InternalPaymentStatus = 'pending'|'authorized'|'paid'|'refunded'|'failed'|'chargeback';

export interface PaymentStatusMapperOptions {
  unknown?: 'throw' | 'unknown' | 'skip';
  legacyReportCasing?: boolean;
}

/** Returns a status string or null (if skip). */
export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {}
): string | null {
  // Switch statement as described.
}

Need to ensure mapping includes all cases.

Potential concerns: The default unknown handling if unspecified: Should default to throwing? In the mapping we need to handle unknown for orders where we explicitly pass unknown:'throw'. For other call sites, we pass explicit unknown handling. But default maybe throw? For safety.

Implementation specifics:

switch(code):
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
    if (options.legacyReportCasing) {
        return 'FAILED';
    }
    return 'failed';
 case 'CHARGEBACK':
    return 'chargeback';
 default:
    switch (options.unknown) {
        case 'skip':
            return null;
        case 'unknown':
            return 'unknown';
        case 'throw':
        default:
            throw new Error(`unknown provider status: ${code}`);
    }

Now for orders: unknown option set to 'throw', no legacy.

Thus unknown default case will throw.

For payouts: unknown option set to 'unknown'.

Thus unknown returns 'unknown'.

For reporting: unknown option set to 'skip', legacyReportCasing true.

Thus unknown returns null.

Now adjust imports to use .js extension.

In src/orders/orders.status.ts, path to shared mapper is '../shared/payment-status-mapper.js', because orders folder is src/orders, relative to src/orders => src/shared/payment-status-mapper.ts is sibling folder under src. So relative path: '..' then 'shared/payment-status-mapper.js'? Actually orders folder path is src/orders; shared folder is src/shared. So from src/orders, the relative path is '../shared/payment-status-mapper.js'. Good.

Similarly, src/payouts/payouts.status.ts import from '../shared/payment-status-mapper.js'.

scripts/reporting.ts import from '../src/shared/payment-status-mapper.js' because scripts folder is at root, src folder is sibling; so relative path from scripts to src/shared is '../src/shared/...'.

Now adjust .js extensions.

Now ensure TypeScript compiles.

Potential type errors:

- In orders status file, mapProviderStatus returns OrderStatus; after calling sharedMapProviderStatus we cast to OrderStatus.

We need to import sharedMapProviderStatus with the same name? Could rename.

Implementation:

import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

export type OrderStatus = ... (as before)

export function mapProviderStatus(code: string): OrderStatus {
  const status = sharedMapProviderStatus(code, { unknown: 'throw' });
  // status is string, but may be 'unknown' if thrown? No, because unknown:'throw' ensures it throws.
  return status as OrderStatus;
}

Now same for payouts:

import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';

export type PayoutStatus = ... (includes unknown)

export function mapProviderStatus(code: string): PayoutStatus {
  const status = sharedMapProviderStatus(code, { unknown: 'unknown' });
  return status as PayoutStatus;
}

Now ensure that the mapping for payout includes unknown: 'unknown' and returns 'unknown' for unknown codes.

Now need to adjust any other code that may reference the mapping? Only orders.service and payouts.service call the mapProviderStatus from their respective status files.

Now need to adjust buildRows function in reporting script:

Currently code:

export function buildRows(...): ReportRow[] {
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

After refactor, mapProviderStatus returns string | null; same behavior.

All good.

Now we need to ensure we added test file for reporting characterization before moving anything. The spec says write characterization tests before moving anything. Since we are moving code, but the tests are added after the move (but they test the new code). However, the spec demands the tests to be written before the move, but in our solution we will include them. Since the repository now includes those tests, and we also made changes accordingly. The spec is satisfied if tests pin the output.

Now we need to ensure we didn't modify any other tests; we haven't changed orders/payouts tests.

Now we need to ensure that tsconfig includes src/shared. Already includes src/**/*.ts, so fine.

Now need to add NOTES.md with documentation.

Create NOTES.md at repo root with description of copies, quirk, divergence.

Now need to ensure no other files changed.

Now the final repository file list:

- src/shared/payment-status-mapper.ts
- src/orders/orders.status.ts (modified)
- src/payouts/payouts.status.ts (modified)
- scripts/reporting.ts (modified)
- test/reporting.spec.ts (new)
- NOTES.md (new)

Now we must provide final solution with all files. Let's construct each file content.

First file: src/shared/payment-status-mapper.ts.

We'll include documentation.

Second file: src/orders/orders.status.ts with modifications.

Third file: src/payouts/payouts.status.ts with modifications.

Fourth file: scripts/reporting.ts with modifications.

Fifth file: test/reporting.spec.ts.

Sixth file: NOTES.md.

Now verify everything.

Check import paths for relative imports:

- In src/orders/orders.status.ts: path `'../shared/payment-status-mapper.js'`. That's correct.

- In src/payouts/payouts.status.ts: `'../shared/payment-status-mapper.js'`.

- In scripts/reporting.ts: path `'../src/shared/payment-status-mapper.js'`. That is correct because scripts folder is at root.

Now ensure that the exported function name: both orders and payouts status file export mapProviderStatus; the shared file also exports mapProviderStatus. They will be imported as alias.

Potential naming conflict: In src/orders/orders.status.ts we have 'export function mapProviderStatus', same name as shared. The import alias is `import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js';` That is fine.

Now confirm test imports path: test/reporting.spec.ts imports from '../scripts/reporting.js'. Path: test folder root is test, scripts folder is sibling to test. So relative path `'../scripts/reporting.js'`. Yes.

Now ensure that TypeScript module resolution works for .js extensions with NodeNext, as used in other imports. In tsconfig they compile to noEmit, but they use .js extensions in imports. So we should follow same pattern.

Now double-check that mapping includes all provider codes:

- Base codes: 'PENDING', 'AWAITING_PAYMENT', 'AUTHORIZED', 'CAPTURED', 'SETTLED', 'REFUNDED', 'PARTIAL_REFUND', 'DECLINED', 'EXPIRED', 'CHARGEBACK'

- Payout-specific: 'PAYOUT_SETTLED', 'PAYOUT_REVERSED'

Now in reporting, originally there is no case for Payout-specific codes; they default to null. Our shared mapper maps them to 'paid' and 'refunded' respectively, but reporting passes unknown:'skip' option, which will treat them as known codes? Actually unknown handling only for default case (unmatched). Since we have explicit cases for those codes, the default case won't be used, so they will map to 'paid' or 'refunded' rather than null. This changes behavior for reporting: originally unknown provider code like 'PAYOUT_SETTLED' would be treated as unknown and return null (skip). But after the move, because we added mapping for these codes, reporting will map them to paid/refunded, not null. This violates the requirement to preserve each call site's behavior. However, does reporting ever see those codes? Probably not; but the spec says to cover the union of provider codes across all three call sites. That implies that the shared mapper should contain all codes and each caller can decide what to do. For reporting, we might want it to treat these codes as unknown (skip). But the spec says "preserving each call site's current behavior via the mapper's API". So reporting's behavior for unknown codes (including those specific to payouts) is to skip (return null). If we add explicit mapping for payout-specific codes, reporting will treat them as known and return a status, not null, which changes behavior (makes it include them). That's not allowed, we must preserve current behavior.

Thus we have a conflict: the union of provider codes must be covered, but we need to preserve behavior for each site. The spec says "Extract a single `PaymentStatusMapper` into `src/shared/`, covering the union of provider codes; the three call sites delegate to it." This suggests that the shared mapper should have mapping for all provider codes across the three copies, i.e., includes payout-specific codes. But then we have to preserve behavior for reporting: i.e., mapping of those codes may produce values but reporting's unknown handling might be to treat them as unknown and skip them. If the mapper has mapping for them, then unknown handling won't be invoked for those codes. Therefore we need a way for reporting to treat those codes as unknown despite them being known to the mapper. How to accomplish? The mapper can have an option to ignore certain provider codes, e.g., "allowExtraCodes" maybe; but spec only mentions an explicit option for the quirk, not for extra codes. However, they said "the three call sites delegate to it." So reporting call site can pass an option that effectively disables mapping for the extra codes, perhaps via a flag like `ignoreExtraCodes`? But not specified. Yet the spec says the mapper should cover the union of provider codes. So the mapper should handle all known codes. But for reporting, unknown handling currently is skip for unknown codes. But for payout codes, they are not unknown; they are now known. So reporting would not skip them but treat them as known statuses. But is that a change in behavior? It might be considered adding support for extra codes. The original behavior was to skip unknown codes, which included those payout-specific ones because they were unknown. After the refactor, they become known and thus will be mapped. Does that count as a behavior change? Probably yes; we are adding functionality for reporting to handle new codes that previously were unknown. But the spec says "Unknown provider codes: today each copy behaves differently (throw / return 'unknown' / silently skip). Preserve each call site's current behavior via the mapper's API; document the divergence in NOTES.md — do NOT unify it." It does not mention preserving behavior for these extra provider codes at reporting. It says preserve each call site's current behavior for unknown provider codes; but extra codes that were not previously known are considered unknown. So for reporting, we should preserve skip for them. Since the union of provider codes is covered, we can still preserve skip by having the reporting call site pass a different option that says "excludeExtraCodes" or "unknownHandlingForExtraCodes" maybe treat unknown as skip even if mapping exists. Or we could treat unknown handling as returning null for any code that is not part of base mapping (i.e., for unknown codes, including extra codes). But the mapper cannot differentiate whether a code is part of base mapping or extra mapping; it only knows the union.

Alternatively, we could implement mapping as a table of provider code to internal status (including extra codes). Then the mapper function can be given an option specifying which subset of mapping to consider (e.g., mode: 'base' vs 'full'). But spec does not ask for that; they only ask to preserve unknown behavior, not to preserve extra code handling.

Maybe we can adjust the behavior for reporting by passing unknown handling as 'skip', but also providing an option that filters out extra codes? The spec only explicitly mentions the legacyReportCasing quirk, not extra code handling. But maybe it's okay that reporting now maps PAYOUT_SETTLED to 'paid', because that could be considered a "known" code, but if no one uses that code in reporting, the behavior change does not affect tests. However the specification wants to preserve behavior for unknown codes, which includes these extra codes. If they are now known, they are no longer unknown, so the "skip" behavior is not applied to them. But does the specification require that reporting skip them? It says "Unknown provider codes: today each copy behaves differently (throw / return 'unknown' / silently skip). Preserve each call site's current behavior via the mapper's API". That suggests that for reporting, unknown codes should still be skipped (i.e., return null). For extra codes not originally recognized by reporting, they are unknown, so they should be skipped. Therefore mapping those codes to internal statuses changes behavior for reporting (it would not skip them). That is a violation. So we must ensure that reporting's mapping of those extra codes continues to result in null (skip) or perhaps be filtered out.

But we could handle this by making the shared mapper's unknown handling default to 'skip' for reporting but still include those codes as known but the calling site could apply a filter after mapping. But the spec says the call sites delegate to it; not that they post-process. However the call site can apply filter logic after mapping (like the original reporting script already had: if (status === null) continue;). That's already present. So if we map extra codes to non-null, they'd be included, which would be a new behavior.

Thus we need to ensure that reporting's call to the mapper treats the extra payout-specific codes as unknown. So perhaps we need to configure the mapper with an option that disables mapping of extra codes. But spec only mentions the quirk option; but we could add another option to indicate "excludePayoutSpecificCodes". But the spec does not forbid adding extra options beyond the quirk; it just says "The quirk becomes an explicit option ... (e.g., { legacyReportCasing: true }), used only by the reporting call site, documented in code."

So we can add extra option(s) if needed, but must keep the quirk explicit. There's no restriction against adding more options. But we need to keep mapping union across all codes. We can implement the mapper to have default mapping for all known codes. Then for reporting we could pass an option like `skipPayoutCodes: true`, which will treat 'PAYOUT_SETTLED' and 'PAYOUT_REVERSED' as unknown (return null). That would preserve original behavior. However this option is not required by the spec, but we could add it for completeness. However, the spec states "covering the union of provider codes; the three call sites delegate to it." So the mapper must know all provider codes. The call sites each delegate. It doesn't require them to be able to ignore extra codes; they just delegate.

If the reporting call site passes unknown handling 'skip', and the mapper knows all provider codes, then for extra payout codes, the mapper will match them and return e.g., 'paid', not null. This changes behavior.

Maybe we could treat unknown handling as being applied not just for default case, but for any code not part of a "whitelisted set" for that call site. For reporting, we could define a whitelist of known provider codes. But the spec didn't define that. However, the simplest approach to preserve original behavior is to keep the mapping unchanged for reporting, i.e., the shared mapper's mapping should only include the base set of codes that reporting currently knows. Then payouts module adds extra codes via a separate mapping? But the spec says "covering the union of provider codes". So the shared mapper should include all codes. If we include all, we must ensure reporting can treat extra ones as unknown. Option: Add an option like `excludeExtraCodes` as above.

Let's think more about spec details:

- The union of provider codes across all three call sites includes the extra payout codes and the base codes. The mapper must cover the union. That means the mapper must be able to map those extra codes when appropriate (payouts). It may not need to expose them to reporting, but they exist in the mapping.

- The call sites delegate to it. For each call site, we can configure options to customize unknown handling and other behaviours.

The spec didn't forbid adding more options besides the quirk; we can add an option to handle extra codes. However the spec explicitly says "The quirk is preserved via an explicit option on the mapper (e.g., { legacyReportCuing: true })". It does not say we cannot have other options. So we can add an option for reporting to treat unknown as skip (which is already present). But we need to treat extra codes as unknown as well. But unknown handling only triggers for default case. So to treat extra codes as unknown, we need to ensure they go to default case for reporting. That means we must make the mapper conditional on a flag indicating which set of codes to include. E.g., `allowPayoutCodes: boolean` or something.

Alternatively, we could implement the mapper with a mapping object that contains all provider codes, and then in the function we look up the code in the mapping object if present. If unknown, we handle unknown. Then we can have the call site pass an option that says `ignoreUnknownCodes` for the reporting but that only affects unknown codes. The extra codes are known, so they will be found. We need to exclude them.

Thus need to implement a mechanism to filter out certain codes.

Better approach: We could design the shared mapper's function to be generic: It returns a status string based on a table of known codes that is passed as argument. The call site can provide the mapping table to use, e.g., baseMapping for orders/reporting, extendedMapping for payouts. But the spec says "extract a single PaymentStatusMapper into src/shared/, covering the union of provider codes". That suggests the mapper has knowledge of all provider codes internally.

Alternatively, we could have the shared mapper's function accept a parameter `context` that determines which mapping to use; e.g., `mode: 'orders'|'payouts'|'reporting'`. Then the function could decide which codes to consider unknown. That is an approach.

But we need to preserve the quirk for reporting; we can also set legacyReportCasing.

Thus we can define options: unknown: 'throw'|'unknown'|'skip', legacyReportCasing: boolean, context: 'orders'|'payouts'|'reporting'? Or we can derive context from unknown behavior? No, unknown behavior differs across contexts. But we may need explicit context.

Better: Keep unknown handling as before, and for reporting we can pass a `skipPayoutCodes` flag to treat payout codes as unknown. That may be simplest.

But the spec didn't require extra option. But if we add it, we must document it. Also we need to update the call site accordingly.

Alternatively, perhaps the mapping for extra payout codes could be omitted; we can keep them as unknown for reporting but still "cover union" via the mapper. How can we cover union without having them as cases? The union might be covered via default case that returns unknown for payouts? But payouts require mapping of those codes to statuses, not unknown. So we need mapping for those codes. But maybe we can handle them in payouts service by mapping after the shared mapper? But spec says only the repository layer (mapper) should be the one that holds mapping, but not to have logic elsewhere.

Thus best to implement extra options.

However, we need to reflect the spec's requirement: "Extract a single `PaymentStatusMapper` into `src/shared/`, covering the union of provider codes; the three call sites delegate to it." That can be interpreted as: The mapper should know all provider codes and produce appropriate internal status. But then the call sites can decide how to treat unknown codes. Since the extra codes are not unknown for payouts; they are known. For reporting, they should be treated as unknown, but the mapper would know them, so they'd be known. But perhaps the original behavior of reporting didn't consider those codes because they never appear. So we can argue that after extraction, mapping them now wouldn't affect anything; it's a behavior addition but not a change for existing cases. However, if someone passes 'PAYOUT_SETTLED' into reporting (unlikely), they'd get 'paid' instead of null. The tests we will write will not test that scenario. The spec only requires preserving existing behavior for existing inputs, not for inputs not previously covered. The spec says "Unknown provider codes: today each copy behaves differently (throw / return 'unknown' / silently skip). Preserve each call site's current behavior via the mapper's API; document the divergence in NOTES.md — do NOT unify it." It does not talk about extra codes for reporting. As long as we preserve unknown handling for unknown codes (codes not in union) we should be fine. But after adding extra mapping for payouts, those codes are now known and would not be considered unknown. That changes behavior for reporting for those particular codes. However, it's possible that we can consider those codes not previously "unknown" for reporting because they didn't exist historically; but now they are known because we added mapping. This is a change. The spec didn't require preserving the behavior for those extra codes; but it says preserve unknown behavior for each call site. Since these codes were unknown before for reporting, they should remain unknown after extraction (i.e., still be unknown). So we need to preserve that.

Thus we need a solution: the shared mapper includes mapping for all codes, but for reporting we still need unknown handling to treat extra codes as unknown. We could make unknown handling treat any code that is not part of a "base" set as unknown. To achieve that, we need to define base set (the set of codes known to orders/reporting) and extended set (including payout specific). Then unknown handling could be based on an option specifying which set to consider. Could have an option `allowPayoutCodes: boolean`. If false, then treat those codes as unknown (skip). So we add that option.

Simplify: we can define a constant set of codes that are base (common) and separate extra. Then for reporting we pass `allowExtraCodes: false`. For payouts we pass `allowExtraCodes: true`. For orders we can also pass false (they don't know extra codes), but unknown handling is throw, so it will treat them as unknown (throw). That's fine.

Implementation details:

- Define two sets:

const baseMapping = new Map<string, string>([
  ['PENDING', 'pending'],
  ['AWAITING_PAYMENT', 'pending'],
  ['AUTHORIZED', 'authorized'],
  ['CAPTURED', 'paid'],
  ['SETTLED', 'paid'],
  ['REFUNDED', 'refunded'],
  ['PARTIAL_REFUND', 'refunded'],
  ['DECLINED', 'failed'],
  ['EXPIRED', 'failed'],
  ['CHARGEBACK', 'chargeback']
]);

const extraMapping = new Map<string, string>([
  ['PAYOUT_SETTLED', 'paid'],
  ['PAYOUT_REVERSED', 'refunded']
]);

Then in mapProviderStatus:

function mapProviderStatus(code: string, options: PaymentStatusMapperOptions = {}): string | null {
  // Determine mapping
  let status: string | undefined;

  if (baseMapping.has(code)) {
    status = baseMapping.get(code)!;
  } else if (options.allowExtraCodes) {
    if (extraMapping.has(code)) {
      status = extraMapping.get(code)!;
    }
  }

  if (status !== undefined) {
    // handle quirk
    if (options.legacyReportCasing && (code === 'DECLINED' || code === 'EXPIRED')) {
      return 'FAILED';
    }
    return status;
  }

  // unknown handling
  switch (options.unknown) {
    case 'skip':
      return null;
    case 'unknown':
      return 'unknown';
    case 'throw':
    default:
      throw new Error(`unknown provider status: ${code}`);
  }
}

Now we have option allowExtraCodes (boolean) default false.

But spec didn't require such option. However, it's necessary to preserve behavior. If we don't add it, we risk breaking reporting for those codes. But maybe tests won't catch that; but spec's "preserve unknown behavior" could be interpreted only for unknown codes, not for the new codes. But it's ambiguous. I'd rather be safe and preserve behavior exactly.

Alternatively, we could treat extra codes as known only when unknown handling is 'unknown' (i.e., for payouts), but that would require checking unknown handling option and mapping accordingly. For reporting, unknown handling is 'skip', so if unknown handling is skip, we could still map extra codes. But we could decide to not map extra codes when unknown handling is 'skip', but then we would also lose extra codes for payouts if they set unknown handling to 'unknown'? Wait payouts uses unknown: 'unknown', and we need to map extra codes. So we could incorporate condition: if unknown handling is 'unknown', also allow extra codes. If unknown handling is 'skip' or 'throw', then treat them as unknown. That could be a heuristic.

But better to be explicit: option `includePayoutCodes`.

Spec didn't forbid adding options; but we must document them in code and maybe in NOTES. However the spec says "The quirk becomes an explicit option... document the quirk, not unify". Adding additional options beyond the quirk may be okay but not required. It might be considered extra complexity but not prohibited.

We need to be mindful of test coverage: We need to add tests for reporting for all known codes, which will pass regardless of extra mapping. We also need to add test for payout's extra codes (they already have test). So after we add extra mapping, payouts tests still pass.

Now we must ensure that orders status test still passes.

Now think about unknown behavior for reporting: In its test we will test that unknown code 'WHATEVER' returns null. That's okay. But we also need to test that extra payout codes return null for reporting. Not required but could be added. But not needed.

Now the shared mapper returns a string or null. For reporting, we call with options {legacyReportCasing:true, unknown:'skip'}. We also may need to pass allowExtraCodes:false to skip extra ones. By default false, fine.

Now for payouts we call with options {unknown:'unknown', allowExtraCodes:true} (the allowExtraCodes could be set to true). Or we can rely on default false but still map extra codes via the main switch. If we have explicit cases for those extra codes in the main switch, then extra codes are known regardless of allowExtraCodes. That would cause reporting to map them incorrectly. So we want extra codes to be in the mapping only if allowExtraCodes:true, else not. So we could move extra code handling into a conditional block based on allowExtraCodes.

Alternatively, we can keep all cases in the switch but treat them as unknown for reporting only if we explicitly check the unknown option. But easier to have mapping table for base codes only in the main block, and extra codes only when allowExtraCodes is true.

Thus modify the mapping as described: use baseMapping and extraMapping. For unknown behavior, we check if allowExtraCodes is true and code in extraMapping then map, else treat as unknown.

Thus the mapping for orders (unknown:'throw', allowExtraCodes:false) will not map payout codes, they will be unknown and throw. That's correct.

For payouts (unknown:'unknown', allowExtraCodes:true) will map extra codes.

For reporting (unknown:'skip', allowExtraCodes:false) will skip those codes.

Thus the shared mapper can have options: {unknown, legacyReportCasing, allowExtraCodes}.

Add type for options:

export interface PaymentStatusMapperOptions {
  unknown?: 'throw' | 'unknown' | 'skip';
  legacyReportCasing?: boolean;
  /** Whether to accept payout-specific provider codes. Defaults to false. */
  allowExtraCodes?: boolean;
}

Now implement.

Now adjust call sites accordingly:

- Orders: mapProviderStatus(code, { unknown: 'throw' }) // allowExtraCodes default false.

- Payouts: mapProviderStatus(code, { unknown: 'unknown', allowExtraCodes: true }) // legacyReportCasing false.

- Reporting: mapProviderStatus(code, { unknown: 'skip', legacyReportCasing: true }) // allowExtraCodes false.

Thus we preserve behavior.

Now ensure we import correctly.

Now adjust code for shared mapper.

Now ensure that the tests for payouts and orders still pass.

Now we need to update orders/status file to import shared mapper alias and call with correct options.

Now need to ensure any other code referencing internal statuses is unaffected.

Now let's draft each file.

### src/shared/payment-status-mapper.ts

Will include description comments.

Implementation:

export type InternalStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';

export interface PaymentStatusMapperOptions {
  /** How to handle unknown provider codes:
   * - 'throw' (default): throws an Error.
   * - 'unknown': returns the string 'unknown'.
   * - 'skip': returns null, signalling the caller to ignore the entry.
   */
  unknown?: 'throw' | 'unknown' | 'skip';
  /** When true, maps DECLINED and EXPIRED to uppercase 'FAILED' for legacy reporting. */
  legacyReportCasing?: boolean;
  /** Whether to support payout-specific provider codes (PAYOUT_SETTLED, PAYOUT_REVERSED).
   * When false (default), those codes are treated as unknown.
   */
  allowExtraCodes?: boolean;
}

/** Map a provider status code to an internal status string.
 * @param code provider status code
 * @param options configuration options
 * @returns an internal status string, or null if `unknown` handling is 'skip'.
 * @throws if `unknown` handling is 'throw' and the code is not recognized.
 */
export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {}
): string | null {
  // Normalize options
  const { unknown = 'throw', legacyReportCasing = false, allowExtraCodes = false } = options;

  // Base mapping (common to all three copies)
  const baseMap: Record<string, InternalStatus> = {
    PENDING: 'pending',
    AWAITING_PAYMENT: 'pending',
    AUTHORIZED: 'authorized',
    CAPTURED: 'paid',
    SETTLED: 'paid',
    REFUNDED: 'refunded',
    PARTIAL_REFUND: 'refunded',
    DECLINED: 'failed',
    EXPIRED: 'failed',
    CHARGEBACK: 'chargeback',
  };

  // Extra payout-specific mapping
  const extraMap: Record<string, InternalStatus> = {
    PAYOUT_SETTLED: 'paid',
    PAYOUT_REVERSED: 'refunded',
  };

  // Resolve status
  let status: InternalStatus | undefined = baseMap[code];
  if (status === undefined && allowExtraCodes) {
    status = extraMap[code];
  }

  if (status !== undefined) {
    // Apply legacy report casing quirk if requested
    if (legacyReportCasing && (code === 'DECLINED' || code === 'EXPIRED')) {
      return 'FAILED';
    }
    return status;
  }

  // Unknown handling
  switch (unknown) {
    case 'skip':
      return null;
    case 'unknown':
      return 'unknown';
    case 'throw':
    default:
      throw new Error(`unknown provider status: ${code}`);
  }
}

Now we need to adjust orders and payouts files.

### src/orders/orders.status.ts

Will import and delegate.

Implementation:

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

export function mapProviderStatus(code: string): OrderStatus {
  const status = sharedMapProviderStatus(code, { unknown: 'throw' });
  // At this point, status is guaranteed to be a valid OrderStatus string.
  return status as OrderStatus;
}
```

Note the relative import path: file is src/orders/orders.status.ts, moving up one level to src/shared.

Thus import `'../shared/payment-status-mapper.js'`. Good.

### src/payouts/payouts.status.ts

Implementation:

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

export function mapProviderStatus(code: string): PayoutStatus {
  const status = sharedMapProviderStatus(code, { unknown: 'unknown', allowExtraCodes: true });
  // The mapper returns a string that matches PayoutStatus.
  return status as PayoutStatus;
}
```

Now adjust script/reporting.ts.

Current file contains mapProviderStatus function directly.

Now after refactor:

```ts
export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

// Shared mapper import
import { mapProviderStatus as sharedMapProviderStatus } from '../src/shared/payment-status-mapper.js';

/**
 * Map provider status code to the reporting CSV status column.
 *
 * This wrapper delegates to the shared PaymentStatusMapper with the legacyReportCasing
 * option enabled, preserving the historic upper‑casing of failed statuses.
 */
export function mapProviderStatus(code: string): string | null {
  return sharedMapProviderStatus(code, { legacyReportCasing: true, unknown: 'skip' });
}

/**
 * Build rows for the nightly CSV report.
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

Make sure import path is correct: scripts folder is at root, so `'../src/shared/payment-status-mapper.js'`.

Now we need to add test/reporting.spec.ts.

Implementation:

```ts
import { describe, expect, it } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping (characterization)', () => {
  it('maps pending codes to pending', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized code to authorized', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled codes to paid', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund codes to refunded', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps declined and expired to FAILED (legacy casing)', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback to chargeback', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown provider status', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
    // Payout‑specific codes are unknown to the reporting script
    expect(mapProviderStatus('PAYOUT_SETTLED')).toBeNull();
    expect(mapProviderStatus('PAYOUT_REVERSED')).toBeNull();
  });
});
```

Now create NOTES.md.

Write documentation: mention the three copies: orders, payouts, reporting. The quirk: legacyReportCasing uppercases FAILED for DECLINED and EXPIRED. Divergence: unknown provider code handling: orders throws, payouts returns 'unknown', reporting skips (null). Also mention the allowExtraCodes option used by payouts only.

Implementation:

```
# NOTES

## Copies of the payment status mapping (pre‑refactor)

| Module    | Mapping behavior                                    |
|-----------|-----------------------------------------------------|
| **orders** | Maps provider status to internal status for display. Throws an error for unknown provider codes. |
| **payouts**| Same base mapping plus two provider‑specific codes (`PAYOUT_SETTLED`, `PAYOUT_REVERSED`). Returns the string `'unknown'` for any provider code it does not recognise. |
| **reporting script** | Same base mapping, but returns the upper‑cased string `'FAILED'` for the `DECLINED` and `EXPIRED` provider codes (the “legacy report casing” quirk). Returns `null` for unknown codes, causing the row to be omitted from the CSV. |

## Legacy report casing quirk

The reporting CSV historically expects the failed status to be upper‑cased (`'FAILED'`). The new `PaymentStatusMapper` exposes this behaviour through the option:

```ts
mapProviderStatus(code, { legacyReportCasing: true })
```

Only the reporting script passes this option. All other callers use the default (`false`).

## Divergent handling of unknown provider codes

The three call sites intentionally keep their original contracts:

| Caller   | `unknown` option passed to `PaymentStatusMapper` | Result for an unknown provider code |
|----------|---------------------------------------------------|--------------------------------------|
| `orders` | `'throw'` (default)                               | throws `Error('unknown provider status: …')` |
| `payouts`| `'unknown'`                                       | returns the string `'unknown'` |
| `reporting`| `'skip'`                                        | returns `null` (row is omitted) |

These behaviours are **deliberate** and are documented here. Any future attempt to unify them must be accompanied by a thorough impact analysis and updated tests.

## Extra provider codes (`PAYOUT_SETTLED`, `PAYOUT_REVERSED`)

Only the payouts domain knows about the two extra provider codes. The shared mapper can handle them when the option `{ allowExtraCodes: true }` is supplied. The orders and reporting callers leave this option unset (default `false`), so those codes are treated as unknown according to each caller’s `unknown` handling strategy.

---

*The extraction preserves all existing behaviours while consolidating the mapping logic into a single, test‑covered location.*
```

Now we need to ensure we haven't broken any imports. Let's check all import paths:

- src/orders/orders.service.ts imports `mapProviderStatus, type OrderStatus` from './orders.status.js'; that file exports mapProviderStatus and OrderStatus. Good.

- src/payouts/payouts.service.ts imports `mapProviderStatus, type PayoutStatus` from './payouts.status.js'; good.

- tests import these same.

Now the shared mapper file is referenced with relative imports from orders/status and payouts/status. Since they are in src/orders and src/payouts, relative import `'../shared/payment-status-mapper.js'` is correct.

Now the scripts/reporting.ts imports shared mapper using `'../src/shared/payment-status-mapper.js'`. Path: from scripts folder, go up one level to root (i.e., scripts is at root), then into src/shared; correct.

Now any other imports referencing the old mapping? Only those three modules. The code also uses mapProviderStatus in scripts. That file's mapProviderStatus function now wraps the shared mapper.

Now tests for orders/payouts unchanged should pass.

Now we must ensure we have not introduced any naming conflict with 'PayoutStatus' type vs shared mapping returning 'unknown' which is a string; we cast to PayoutStatus; that's okay.

Now check TypeScript errors: In src/payouts/payouts.status.ts we need to import { mapProviderStatus as sharedMapProviderStatus } from '../shared/payment-status-mapper.js'; path: file at src/payouts/payouts.status.ts; relative path '..' goes to src, then 'shared' is sibling directory; correct.

Now ensure the exported types and functions compile.

Now check that src/shared/payment-status-mapper.ts uses string as keys. Should be fine.

Now check that we use .js extensions in imports. Yes.

Now test for reporting mapping: we imported from '../scripts/reporting.js'. In test file path, test folder is test/, so `'../scripts/reporting.js'` goes from test to root to scripts, correct.

Now confirm we didn't need to add a .d.ts file; not needed.

Now we need to add new files.

Thus final answer will consist of multiple file blocks.

Now double-check any possible errors: In src/shared/payment-status-mapper.ts, we used const baseMap: Record<string, InternalStatus>. That is fine. For extraMap: same.

Now ensure we export type InternalStatus if needed. Not used elsewhere; but fine.

Now confirm that we have no naming conflicts. The exported function name is same as before: mapProviderStatus. That may cause naming confusion but each module uses its own version, but we also export from shared. That's okay.

Now confirm that tests for orders and payouts will still import from their respective status files; those wrappers will delegate to shared mapper.

Now ensure that we didn't accidentally create a cyc import. There should be no cycles.

Now check the buildRows function: unchanged.

Now check that the test for reporting includes the mapping for extra codes expecting null; we added that.

Now verify that the test for reporting includes case for 'FAILED' uppercase. Yes.

Now check the test's import path: `'../scripts/reporting.js'` is correct, but TypeScript's module resolution with NodeNext expects .js extension. Good.

Now ensure that the shared mapper's default unknown handling is 'throw', but we didn't need default as we always pass options. In orders we pass unknown:'throw', in payouts unknown:'unknown', in reporting unknown:'skip'.

Now confirm that we included the option `allowExtraCodes` only for payouts. In payouts we pass `allowExtraCodes: true`. Good.

Now check that orders passes unknown:'throw' but does not set allowExtraCodes; default false, so payout codes are unknown; default unknown handling is 'throw', so they will cause throw. That matches original.

Now test coverage: No tests for orders with payout codes. Not needed.

Now we should also update import path for shared file inside src/orders/orders.status.ts: It uses relative path `'../shared/payment-status-mapper.js'`. That resolves to src/shared/payment-status-mapper.js which exists.

Now check tsconfig's include: includes src/**/*.ts, test/**/*.ts, scripts/**/*.ts. Shared folder is under src, included.

Now run through each test mentally:

- test/orders.status.spec.ts: mapProviderStatus('CAPTURED') returns 'paid' via orders.status wrapper which calls shared mapper with unknown:'throw' and no allowExtraCodes. shared mapper baseMap['CAPTURED'] = 'paid', so status = 'paid', legacyReportCasing false => returns 'paid'. Cast to OrderStatus fine. test passes. mapProviderStatus('REFUNDED') returns 'refunded', passes. mapProviderStatus('WHATEVER') => baseMap doesn't contain, allowExtraCodes false => status undefined; unknown handling 'throw' -> throw error. test expects to throw, passes.

- test/payouts.status.spec.ts: mapProviderStatus('PAYOUT_SETTLED') => baseMap undefined, allowExtraCodes true, extraMap['PAYOUT_SETTLED'] = 'paid', returns 'paid', cast to PayoutStatus passes. mapProviderStatus('PAYOUT_REVERSED') => 'refunded', passes.

- test/reporting.spec.ts:

   - mapProviderStatus('PENDING') => baseMap returns 'pending', legacyReportCasing false (not needed) => 'pending'. OK.
   - 'AWAITING_PAYMENT' => 'pending'.
   - 'AUTHORIZED' => 'authorized'.
   - 'CAPTURED' => 'paid'.
   - 'SETTLED' => 'paid'.
   - 'REFUNDED' => 'refunded'.
   - 'PARTIAL_REFUND' => 'refunded'.
   - 'DECLINED' => baseMap returns 'failed', legacyReportCasing true => returns 'FAILED'. So test expects 'FAILED', passes.
   - 'EXPIRED' => 'FAILED', passes.
   - 'CHARGEBACK' => 'chargeback', passes.
   - unknown: 'WHATEVER' => baseMap undefined, allowExtraCodes false (default), unknown handling 'skip' => returns null; test expects null. Pass.
   - 'PAYOUT_SETTLED' => baseMap undefined, allowExtraCodes false => unknown handling 'skip' => null. Pass.
   - 'PAYOUT_REVERSED' similarly null. Pass.

All tests pass.

Now the spec also says pre-existing tests should pass unmodified. Our modifications do not change them, they still import same modules.

Now we need to ensure that all pre-existing tests pass: Already covered.

Now we need to ensure that the mapping code for unknown handling defaults to throw if not provided, but we always pass explicit options, so fine.

Now confirm that the shared mapper's function is exported as default? Not needed, just named export.

Now ensure we have correct file paths.

Now the final answer must list each file with heading and fenced code block.

We need to list:

- src/shared/payment-status-mapper.ts
- src/orders/orders.status.ts
- src/payouts/payouts.status.ts
- scripts/reporting.ts
- test/reporting.spec.ts
- NOTES.md

We should also include any other files we changed? Possibly we need to update import paths in order of test imports; but they remain same.

Now provide final solution.
```

## reply

### src/shared/payment-status-mapper.ts
```ts
// Shared mapper for provider status → internal status.
// Covers the union of all provider codes used by orders, payouts, and reporting.
// Call sites can customise behaviour via options.

export type InternalStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export interface PaymentStatusMapperOptions {
  /**
   * How to handle unknown provider codes.
   *
   * - 'throw' (default) – throws an Error.
   * - 'unknown' – returns the literal string `'unknown'`.
   * - 'skip' – returns `null`, signalling the caller to ignore the entry.
   */
  unknown?: 'throw' | 'unknown' | 'skip';
  /**
   * When true, maps `DECLINED` and `EXPIRED` to the upper‑cased string `'FAILED'`
   * for the legacy reporting CSV format.
   */
  legacyReportCasing?: boolean;
  /**
   * Whether to recognise payout‑specific provider codes (`PAYOUT_SETTLED`,
   * `PAYOUT_REVERSED`). When false (default) those codes are treated as unknown.
   */
  allowExtraCodes?: boolean;
}

/**
 * Map a provider status code to an internal status string.
 *
 * @param code Provider status code.
 * @param options Configuration options.
 * @returns Internal status string, or `null` if `unknown` handling is `'skip'`.
 * @throws If `unknown` handling is `'throw'` and the code is not recognised.
 */
export function mapProviderStatus(
  code: string,
  options: PaymentStatusMapperOptions = {}
): string | null {
  const {
    unknown = 'throw',
    legacyReportCasing = false,
    allowExtraCodes = false,
  } = options;

  // Base mapping – common to all three call‑sites.
  const baseMap: Record<string, InternalStatus> = {
    PENDING: 'pending',
    AWAITING_PAYMENT: 'pending',
    AUTHORIZED: 'authorized',
    CAPTURED: 'paid',
    SETTLED: 'paid',
    REFUNDED: 'refunded',
    PARTIAL_REFUND: 'refunded',
    DECLINED: 'failed',
    EXPIRED: 'failed',
    CHARGEBACK: 'chargeback',
  };

  // Extra mapping – only the payouts domain knows about these codes.
  const extraMap: Record<string, InternalStatus> = {
    PAYOUT_SETTLED: 'paid',
    PAYOUT_REVERSED: 'refunded',
  };

  // Resolve the status from the appropriate map.
  let status: InternalStatus | undefined = baseMap[code];
  if (status === undefined && allowExtraCodes) {
    status = extraMap[code];
  }

  if (status !== undefined) {
    // Apply the legacy report casing quirk when requested.
    if (legacyReportCasing && (code === 'DECLINED' || code === 'EXPIRED')) {
      return 'FAILED';
    }
    return status;
  }

  // Unknown provider code handling.
  switch (unknown) {
    case 'skip':
      return null;
    case 'unknown':
      return 'unknown';
    case 'throw':
    default:
      throw new Error(`unknown provider status: ${code}`);
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

export function mapProviderStatus(code: string): OrderStatus {
  // Orders treat unknown codes as fatal errors.
  const status = sharedMapProviderStatus(code, { unknown: 'throw' });
  // The shared mapper guarantees the result matches OrderStatus when it does not throw.
  return status as OrderStatus;
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

export function mapProviderStatus(code: string): PayoutStatus {
  // Payouts accept the extra payout‑specific codes and return 'unknown' for any truly unknown code.
  const status = sharedMapProviderStatus(code, {
    unknown: 'unknown',
    allowExtraCodes: true,
  });
  return status as PayoutStatus;
}
```

### scripts/reporting.ts
```ts
export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

// The reporting script now delegates to the shared mapper.
// The legacyReportCasing option preserves the historic upper‑casing of failed statuses.
import { mapProviderStatus as sharedMapProviderStatus } from '../src/shared/payment-status-mapper.js';

/**
 * Map provider status code to the status column used in the finance CSV.
 *
 * The `legacyReportCasing` flag is set to true to retain the original behaviour
 * where `DECLINED` and `EXPIRED` map to the upper‑cased string `'FAILED'`.
 */
export function mapProviderStatus(code: string): string | null {
  return sharedMapProviderStatus(code, {
    legacyReportCasing: true,
    unknown: 'skip',
  });
}

/**
 * Build the rows for the nightly CSV report.
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

### test/reporting.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { mapProviderStatus } from '../scripts/reporting.js';

describe('reporting status mapping (characterization)', () => {
  it('maps pending codes to pending', () => {
    expect(mapProviderStatus('PENDING')).toBe('pending');
    expect(mapProviderStatus('AWAITING_PAYMENT')).toBe('pending');
  });

  it('maps authorized code to authorized', () => {
    expect(mapProviderStatus('AUTHORIZED')).toBe('authorized');
  });

  it('maps settled codes to paid', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps refund codes to refunded', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('maps declined and expired to FAILED (legacy casing)', () => {
    expect(mapProviderStatus('DECLINED')).toBe('FAILED');
    expect(mapProviderStatus('EXPIRED')).toBe('FAILED');
  });

  it('maps chargeback to chargeback', () => {
    expect(mapProviderStatus('CHARGEBACK')).toBe('chargeback');
  });

  it('returns null for unknown provider status', () => {
    expect(mapProviderStatus('WHATEVER')).toBeNull();
    // Payout‑specific codes are unknown to the reporting script.
    expect(mapProviderStatus('PAYOUT_SETTLED')).toBeNull();
    expect(mapProviderStatus('PAYOUT_REVERSED')).toBeNull();
  });
});
```

### NOTES.md
```
# NOTES

## Copies of the payment status mapping (pre‑refactor)

| Module                | Behaviour                                                                                               |
|-----------------------|----------------------------------------------------------------------------------------------------------|
| **orders**            | Maps provider status to internal status for the order detail screen. Throws an error for unknown codes. |
| **payouts**           | Same base mapping plus two payout‑specific codes (`PAYOUT_SETTLED`, `PAYOUT_REVERSED`). Returns `'unknown'` for any provider code it does not recognise. |
| **reporting script**  | Same base mapping, but returns the upper‑cased string `'FAILED'` for `DECLINED` and `EXPIRED` (legacy report casing). Returns `null` for unknown codes, causing the row to be omitted from the CSV. |

## Legacy report casing quirk

The finance CSV historically expects the failed status to be upper‑cased (`'FAILED'`).  
The new `PaymentStatusMapper` exposes this behaviour via the option:

```ts
mapProviderStatus(code, { legacyReportCasing: true })
```

Only the reporting script supplies this option. All other callers use the default (`false`).

## Divergent handling of unknown provider codes

| Caller     | `unknown` option passed | Result for an unknown provider code |
|------------|------------------------|--------------------------------------|
| `orders`   | `'throw'` (default)    | **throws** `Error('unknown provider status: …')` |
| `payouts`  | `'unknown'`            | **returns** the string `'unknown'` |
| `reporting`| `'skip'`               | **returns** `null` (row is omitted) |

These behaviours are **deliberate** and documented here. Any future attempt to unify them must be accompanied by a thorough impact analysis and updated tests.

## Extra provider codes (`PAYOUT_SETTLED`, `PAYOUT_REVERSED`)

Only the payouts domain knows about the two extra provider codes.  
The shared mapper can handle them when the option `{ allowExtraCodes: true }` is supplied.  
Orders and reporting callers leave this option unset (default `false`), so those codes are treated as unknown according to each caller’s `unknown` handling strategy.

---

*The extraction consolidates all mapping logic while preserving every existing contract, including the legacy CSV quirk and the three distinct unknown‑code behaviours.*
