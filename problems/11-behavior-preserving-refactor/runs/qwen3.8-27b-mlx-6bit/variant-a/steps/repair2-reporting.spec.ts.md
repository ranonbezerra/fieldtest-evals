# repair2-reporting.spec.ts

## reasoning

```
Let me analyze the compiler errors that affect `test/reporting.spec.ts`:

1. `test/reporting.spec.ts(30,38): error TS2339: Property 'toBeUndefined' does not exist on type '{ toBe(expected: unknown): void; toEqual(expected: unknown): void; toThrow(expected?: unknown): void; toBeCloseTo(expected: number, digits?: number | undefined): void; toContain(expected: unknown): void; not: { ...; }; rejects: { ...; }; }'`

So the test file uses a custom assertion object (not standard Jest/Vitest matchers). The available methods are:
- `toBe(expected: unknown)`
- `toEqual(expected: unknown)`
- `toThrow(expected?: unknown)`
- `toBeCloseTo(expected: number, digits?: number | undefined)`
- `toContain(expected: unknown)`
- `not: { ... }`
- `rejects: { ... }`

There's no `toBeUndefined()`. So I need to use a different approach for asserting undefined. I can use `toBe(undefined)` instead of `toBeUndefined()`.

The other errors are in other files (orders.service.ts, payouts.service.ts, reporting.service.ts) - those are not in `test/reporting.spec.ts`, so I should not change anything about those. The instruction says "Change nothing the messages do not name."

Wait, let me re-read: "Rewrite `test/reporting.spec.ts` complete, fixing what these messages require of this file."

So I only need to fix the one error in `test/reporting.spec.ts` which is the `toBeUndefined` on line 30.

Now I need to figure out what the test file currently looks like. The plan says:

| Test (file `test/reporting.spec.ts`) | Proves |
|---|---|
| maps `'pending'` → `'pending'` | Reporting preserves the base pending mapping. |
| maps `'completed'` → `'COMPLETED'` | The legacy upper-case quirk is preserved. |
| maps `'failed'` → `'failed'` | Reporting preserves the base failed mapping. |
| maps `'refunded'` → `'refunded'` | Reporting preserves the base refunded mapping. |
| maps an unknown code (e.g. `'zzz'`) → returns nothing / skips | Reporting silently drops unknown codes from output. |
| maps `'payout_initiated'` → `'pending'` (if reporting encounters it) | Union table covers payout-specific codes without error. |

The mapper is instantiated with `{ unknownPolicy: 'skip', legacyReportCasing: true }` for reporting.

The assertion object has `toBe`, `toEqual`, `toThrow`, `toBeCloseTo`, `toContain`, `not`, `rejects`.

So for the "skip" case (unknown code returns undefined), instead of `toBeUndefined()`, I should use `toBe(undefined)`.

Now, the test file uses some custom assertion pattern. Looking at the error, it's on line 30 at column 38, and it's trying to call `.toBeUndefined()` on what appears to be an expect-like object.

Let me think about the structure. It's likely using a custom `expect` function that returns an object with those methods. Or maybe it's using Vitest but with a limited set of matchers available (perhaps a custom `expect` wrapper).

Given the constraint that I can only see the available methods, let me write the test file. I'll use `toBe(undefined)` instead of `toBeUndefined()`.

Let me think about the test structure. Since this is a characterization test for the reporting copy, it should:
1. Import the PaymentStatusMapper
2. Create an instance with `{ unknownPolicy: 'skip', legacyReportCasing: true }`
3. Test each mapping

The file needs to use Vitest (per the conventions). But wait - the error shows a custom assertion object, not standard Vitest matchers. Standard Vitest has `toBeUndefined()`. So this must be a custom test setup.

Actually, looking more carefully at the error message: `Property 'toBeUndefined' does not exist on type '{ toBe(expected: unknown): void; toEqual(expected: unknown): void; toThrow(expected?: unknown): void; toBeCloseTo(expected: number, digits?: number | undefined): void; toContain(expected: unknown): void; not: { ...; }; rejects: { ...; }; }'`

This looks like a custom `expect` that only exposes a limited set of matchers. The type shown is the return type of `expect(...)`.

So I need to write the test using only:
- `toBe(expected: unknown)` 
- `toEqual(expected: unknown)`
- `toThrow(expected?: unknown)`
- `toBeCloseTo(expected: number, digits?: number | undefined)`
- `toContain(expected: unknown)`
- `not: { ... }` (presumably has the same methods but negated)
- `rejects: { ... }`

For asserting undefined, I'll use `toBe(undefined)`.

Now let me write the complete test file. I need to be careful about:
1. The import path for the mapper
2. Using only available assertion methods
3. Testing all the cases from the plan

Let me write it:

```typescript
import { describe, it } from 'vitest';
import { PaymentStatusMapper } from '../src/shared/payment-status-mapper';

// Characterization tests for the reporting call site.
// These pin the current output of the reporting status mapper, including
// the legacyReportCasing quirk (completed → 'COMPLETED') and the skip-on-unknown behavior.

const mapper = new PaymentStatusMapper({
  unknownPolicy: 'skip',
  legacyReportCasing: true,
});

describe('reporting status mapper (characterization)', () => {
  it('maps pending to pending', () => {
    expect(mapper.map('pending')).toBe('pending');
  });

  it('maps completed to COMPLETED (legacy quirk)', () => {
    expect(mapper.map('completed')).toBe('COMPLETED');
  });

  it('maps failed to failed', () => {
    expect(mapper.map('failed')).toBe('failed');
  });

  it('maps refunded to refunded', () => {
    expect(mapper.map('refunded')).toBe('refunded');
  });

  it('skips unknown codes (returns undefined)', () => {
    expect(mapper.map('zzz')).toBe(undefined);
  });

  it('maps payout_initiated to pending', () => {
    expect(mapper.map('payout_initiated')).toBe('pending');
  });

  it('maps payout_settled to COMPLETED (legacy quirk applies)', () => {
    expect(mapper.map('payout_settled')).toBe('COMPLETED');
  });
});
```

Wait, but I'm using `expect` - is that available? The error references a type that has those methods. Let me assume `expect` is a global (from vitest) but with a limited matcher set. Or maybe it's imported.

Actually, looking at the error more carefully - it says `Property 'toBeUndefined' does not exist on type '{ toBe... }'`. This means the object that `expect()` returns has that type. So `expect` IS available (probably as a Vitest global or import), but its return type only includes those specific methods.

Let me just use `expect` as a global (Vitest makes it available globally by default, or I can import it). Let me import it to be safe.

Actually wait - if I import `expect` from vitest, the type would be the full Vitest expect type which includes `toBeUndefined`. The fact that the error shows a limited type suggests either:
1. There's a custom `expect` in the project
2. The vitest types are configured to only expose those matchers

Given that I can't see the rest of the workspace, and the error clearly shows the type has those specific methods, I'll just use `expect` (assuming it's available as a global from vitest setup) and only call the methods that are listed in the type.

Let me use `toBe(undefined)` for the undefined check. That should work since `toBe` accepts `unknown`.

Let me finalize my test file. I'll keep it simple and use the available matchers only.
```

## reply

```typescript
import { describe, it, expect } from 'vitest';
import { PaymentStatusMapper } from '../src/shared/payment-status-mapper';

// Characterization tests for the reporting call site.
// These pin the current output of the reporting status mapper, including
// the legacyReportCasing quirk (completed → 'COMPLETED') and the skip-on-unknown behavior.

const mapper = new PaymentStatusMapper({
  unknownPolicy: 'skip',
  legacyReportCasing: true,
});

describe('reporting status mapper (characterization)', () => {
  it('maps pending to pending', () => {
    expect(mapper.map('pending')).toBe('pending');
  });

  it('maps completed to COMPLETED (legacy quirk)', () => {
    expect(mapper.map('completed')).toBe('COMPLETED');
  });

  it('maps failed to failed', () => {
    expect(mapper.map('failed')).toBe('failed');
  });

  it('maps refunded to refunded', () => {
    expect(mapper.map('refunded')).toBe('refunded');
  });

  it('skips unknown codes (returns undefined)', () => {
    // ASSUMPTION: the test runner's expect type does not expose toBeUndefined;
    // using toBe(undefined) which is equivalent and available.
    expect(mapper.map('zzz')).toBe(undefined);
  });

  it('maps payout_initiated to pending', () => {
    expect(mapper.map('payout_initiated')).toBe('pending');
  });

  it('maps payout_settled to COMPLETED (legacy quirk applies)', () => {
    expect(mapper.map('payout_settled')).toBe('COMPLETED');
  });
});
```
