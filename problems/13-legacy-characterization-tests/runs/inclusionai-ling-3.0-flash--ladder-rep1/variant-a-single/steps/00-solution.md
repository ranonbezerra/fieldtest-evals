# solution

## reasoning

```
Let me analyze the task carefully. I need to:

1. Create a characterization test suite for `feeCalculator.ts` that pins current behavior
2. Create a `FINDINGS.md` documenting quirks and bugs found
3. Not modify the production code at all

Let me study the `feeCalculator.ts` code carefully to understand all behaviors.

**Key behaviors to test:**

1. **Case type × complexity band matrix**: 4 case types (STANDARD, COMMERCIAL, ESTATE, APPEAL) × 4 bands (1-4) = 16 combinations. Unknown types fall back to STANDARD.

2. **Rate table selection by date**:
   - `openedAt < 2021-01-01` → RATE_TABLE_2019 (table: '2019')
   - `openedAt >= 2021-01-01` and `openedAt <= 2022-06-30` (i.e., not > 2022-07-01) → RATE_TABLE_2021 (table: '2021')
   - `openedAt > 2022-07-01` → RATE_TABLE_2022 (table: '2022')
   
   Wait, let me re-check `tableFor`:
   ```
   if (openedAt >= REVISION_2021) {  // >= 2021-01-01
     if (openedAt > REVISION_2022) { // > 2022-07-01
       return RATE_TABLE_2022;
     }
     return RATE_TABLE_2021;
   }
   return RATE_TABLE_2019;
   ```
   
   So:
   - `openedAt < 2021-01-01` → 2019
   - `openedAt >= 2021-01-01` AND `openedAt <= 2022-07-01` → 2021
   - `openedAt > 2022-07-01` → 2022
   
   Edge cases:
   - `openedAt = '2021-01-01'` → 2021 (inclusive on left edge of 2021)
   - `openedAt = '2022-07-01'` → 2021 (inclusive on right edge of 2021, exclusive on 2022)
   - `openedAt = '2022-07-02'` → 2022
   - `openedAt = '2020-12-31'` → 2019

3. **Urgency multipliers**: Triggered when `c.deadline` is provided and `daysBetween(ref, c.deadline) <= 7`. The `ref` is the `now` parameter or current date. Since we need deterministic tests, we'll use `now`.
   - Note: `daysBetween(ref, c.deadline)` computes `(deadline - ref) / 86400000`. If deadline is in the future from ref, this is positive. If deadline is in the past, negative.
   - So urgency is triggered when deadline is within 7 days of ref (in the past or future).
   - Edge: exactly 7 days away → urgent; 8 days away → not urgent.

4. **Expedited**: `c.expedited === true` adds `pctOf(bandFee + urgencyFee, expeditedPct)`.

5. **Rounding**: `pctOf` uses `Math.round` — rounding at each percentage calculation step. This happens for urgency and expedited fees.

6. **Band clamping**: complexity < 1 → 1, > 4 → 4. Zero and negative → 1.

7. **Unknown case type**: Falls back to STANDARD base rates.

8. **Complexity null/undefined**: Throws error.

**Quirks and bugs I can identify:**

1. **The `ref` date uses real time by default**: `new Date().toISOString().slice(0, 10)` — this means without `now`, the result depends on the current date. This is a bug because urgency calculations become non-deterministic and date-dependent. (But this is by design since `now` is optional — the finding should note that the default behavior is non-deterministic.)

2. **Urgency deadline check is asymmetric**: `daysBetween(ref, c.deadline)` where ref is "now" and deadline is the case deadline. If the deadline has passed by more than 7 days, `daysBetween` returns a large negative number which is `<= 7`, so urgency would STILL apply. Wait, let me reconsider:

   `daysBetween(ref, c.deadline)`:
   - If deadline is 10 days in the past: `deadline - ref` is negative → e.g., -10 → `-10 <= 7` → TRUE → urgency applies!
   - If deadline is exactly 7 days in the future: `7` → `7 <= 7` → TRUE → urgency applies.
   - If deadline is 8 days in the future: `8` → `8 <= 7` → FALSE → no urgency.

   So urgency applies for: ANY deadline in the past (even years past) AND deadlines up to 7 days in the future. This seems like a bug — if a case deadline expired long ago, the system still treats it as urgent. That doesn't seem right. A more sensible behavior would be to check if the deadline is within 7 days in the future only, or perhaps within 7 days from now (past or future). But as written, anything in the past triggers it.

   Actually wait — let me re-read. `daysBetween(ref, c.deadline)` = `(deadline_date - ref_date) / 86400000`. If ref is today and deadline was yesterday, that's -1. -1 <= 7 → true → urgency. If deadline was 100 days ago, that's -100. -100 <= 7 → true → urgency. This is almost certainly a bug — expired deadlines should not be "urgent".

3. **`band` variable shadowing**: When `c.complexity` is 0 or negative, `band = c.complexity` (0 or negative), then `if (!band || band < 1)` → band becomes 1. But if `c.complexity` is 0, `!band` is true (0 is falsy), so band becomes 1. Fine. But there's no validation for non-integer complexity values. What happens with 1.5? `bands[1.5 - 1]` = `bands[0.5]` = undefined. That could be a bug.

4. **`deadline` comparison doesn't validate format**: If deadline is an invalid date string, `new Date(deadline).getTime()` returns NaN, and comparisons with NaN always return false.

5. **The urgency check with `now` parameter**: The `now` parameter is typed as `string` and is used as `ref`. But the comment says "a fake clock may be injected ONLY via the module's existing optional `now` parameter." The `now` string is used directly in `daysBetween`, which passes it to `new Date()`.

Let me now think about what the test suite needs to cover and what FINDINGS.md should contain.

**Quirks/Bugs to document in FINDINGS.md:**

1. **BUG: Past deadlines always trigger urgency** — `daysBetween(ref, deadline) <= 7` is true for any past deadline (negative values), meaning cases with long-expired deadlines are still marked urgent. Blast radius: all historical fees for cases with deadlines that have passed would have had urgency fees added. Fix: should likely be `>= 0 && <= 7` or `<= 7 && > 0`.

2. **QUIRK: Non-integer complexity silently produces undefined bandFee** — if complexity is 1.5, `band = 1.5`, `bands[0.5]` is undefined, so `bandFee` is NaN, and the entire total becomes NaN.

3. **QUIRK: Default urgency uses wall clock** — when `now` is not provided, `new Date().toISOString().slice(0, 10)` is used, making results non-deterministic. Any historical fee calculation without `now` was date-dependent in a way that's hard to audit.

4. **QUIRK: Urgency applies retroactively for all past deadlines** — closely related to #1. If the intent was "deadline within 7 days", the current code means "deadline within 7 days in the future OR any time in the past."

Now let me design the test suite.

The test file should be comprehensive. Let me think about the structure:

- Import `calculateFee`, `CaseInput` from feeCalculator.ts
- Use vitest
- All tests deterministic (use `now` parameter)

Let me create the files:

1. `test/feeCalculator.spec.ts` — the characterization suite
2. `FINDINGS.md` — findings document

Since the codebase is described as NestJS/TypeScript with vitest, I'll structure the test accordingly.

Let me think carefully about what exact values to compute for the matrix. Since the production code is not to be changed, I need to compute expected values that match what the code would produce. Let me trace through carefully.

For a STANDARD case, complexity 1, using RATE_TABLE_2019:
- bandFee = 12000
- If urgent: urgencyFee = Math.round(12000 * 15 / 100) = Math.round(1800) = 1800
- If expedited: expeditedFee = Math.round((12000 + 1800) * 10 / 100) = Math.round(1380) = 1380
- total = 12000 + 1800 + 1380 = 15180

For COMMERCIAL, complexity 2, RATE_TABLE_2021:
- bandFee = 34000
- No urgency, no expedited: total = 34000

Let me not compute every single value manually. Instead, the test suite should assert values that match the code's behavior. The key is that the tests are characterization tests — they pin what the code does.

Actually, since I need to write a complete test suite, let me write it systematically. I'll structure it to test behaviors rather than hardcode every single matrix cell value manually. But I do need to provide the actual expected numbers.

Let me think about this differently. The test suite needs to:
1. Test every case type × complexity band combination
2. Test urgency boundaries
3. Test rate table boundaries
4. Test rounding
5. Test degenerate inputs

For the matrix tests, I can parameterize and use a helper function to compute expected values from the rate tables directly (mirroring the code logic). But wait — the instructions say the production code must be untouched and I should not create extra files. Let me think about what's allowed.

Actually, the test file is what I need to create. I can compute expected values within the test file. Let me write comprehensive tests.

Let me create the test file. I'll organize it clearly:

```
test/feeCalculator.spec.ts
```

And FINDINGS.md.

Let me trace through some specific values for the matrix tests. I'll pick a fixed `now` date for all matrix tests (e.g., '2023-06-15') and no deadline/expedited to isolate the base behavior.

For the matrix, I'll test each case type × band with a date that falls in a known rate table period. Let me use dates that map to each table:
- For 2019 table: openedAt = '2019-06-15'
- For 2021 table: openedAt = '2021-06-15'
- For 2022 table: openedAt = '2023-06-15'

Actually, to keep it simpler, I can test the matrix for one table (e.g., 2021) and then separately test the table selection logic. Or I can test the full matrix with a consistent date.

Let me be more systematic. The test file will have describe blocks:

1. **Full matrix: case type × complexity band** — test all 16 combinations (4 types × 4 bands) for a representative rate table, and also test the fallback for unknown types.
2. **Rate table selection** — test date boundaries (inclusive/exclusive).
3. **Urgency multipliers** — test boundary at 7 days, 8 days, past deadlines.
4. **Expedited fee** — test that it's applied and compounding.
5. **Rounding** — test specific values where rounding matters.
6. **Degenerate inputs** — zero, negative, null, undefined, unknown type, >4.
7. **Pinned quirks and bugs** — tests with names that flag them.

Now let me write out the actual test values. I need to be precise.

For RATE_TABLE_2021, STANDARD:
- Band 1: 13500
- Band 2: 20500
- Band 3: 29500
- Band 4: 44500

Urgency at 15%:
- Band 1: Math.round(13500 * 15 / 100) = Math.round(2025) = 2025
- Band 2: Math.round(20500 * 15 / 100) = Math.round(3075) = 3075
- Band 3: Math.round(29500 * 15 / 100) = Math.round(4425) = 4425
- Band 4: Math.round(44500 * 15 / 100) = Math.round(6675) = 6675

Expedited at 12% of (bandFee + urgencyFee):
- Band 1: Math.round((13500 + 2025) * 12 / 100) = Math.round(15525 * 12 / 100) = Math.round(1863) = 1863
- Band 2: Math.round((20500 + 3075) * 12 / 100) = Math.round(23575 * 12 / 100) = Math.round(2829) = 2829
- Band 3: Math.round((29500 + 4425) * 12 / 100) = Math.round(33925 * 12 / 100) = Math.round(4071) = 4071
- Band 4: Math.round((44500 + 6675) * 12 / 100) = Math.round(51175 * 12 / 100) = Math.round(6141) = 6141

Totals (all three):
- Band 1: 13500 + 2025 + 1863 = 17388
- Band 2: 20500 + 3075 + 2829 = 26404
- Band 3: 29500 + 4425 + 4071 = 37996
- Band 4: 44500 + 6675 + 6141 = 57316

Let me also compute for RATE_TABLE_2019, STANDARD:
- Band 1: 12000
- Urgency (15%): Math.round(12000 * 15 / 100) = 1800
- Expedited (10% of (12000 + 1800)): Math.round(13800 * 10 / 100) = 1380
- Total: 15180

RATE_TABLE_2022, STANDARD:
- Band 1: 15000
- Urgency (18%): Math.round(15000 * 18 / 100) = 2700
- Expedited (12% of (15000 + 2700)): Math.round(17700 * 12 / 100) = Math.round(2124) = 2124
- Total: 15000 + 2700 + 2124 = 19824

OK, I think I have enough understanding. Now let me write the complete test file and FINDINGS.md.

Actually, let me reconsider the structure. The task says "Deliver: the suite + FINDINGS.md." So I need:

1. A test file (vitest)
2. FINDINGS.md

The test file needs to import from `feeCalculator.ts`. Let me think about the relative path. The feeCalculator.ts is at the workspace root. The test file would be at `test/feeCalculator.spec.ts`. The import would be `../feeCalculator` or `../feeCalculator.ts`.

Wait, looking at the tsconfig, it includes `*.ts` at root level, not the test directory. But for the test, it would need to compile fine. Let me check what vitest config would be needed. Actually, I think for this task I should just focus on writing the test file and FINDINGS.md. The vitest configuration should already exist or can be assumed.

Let me also think about whether I need a vitest config file. The task mentions vitest, so there should be one. But since the task says not to create files not called for... Actually, the test file IS what I need to create. Let me include a basic vitest config if needed.

Hmm, looking at the workspace, there's a tsconfig.json. For vitest, there typically needs to be a vitest config. But since I'm told not to create files unnecessarily, and the task is about the test suite and findings, let me just create those two files.

Now let me write the test suite. I need to be very thorough.

```typescript
import { describe, it, expect } from 'vitest';
import { calculateFee, CaseInput } from '../feeCalculator';
```

Wait, since it's ESM, the import should work. Let me write the full suite.

One more thing: the task says the `now` parameter is a string. So when calling `calculateFee(input, '2023-01-15')`, it uses that as the reference date for urgency calculations.

Let me think about urgency boundary tests more carefully.

`daysBetween(ref, deadline)`:
- ref = '2023-06-15'
- deadline = '2023-06-08' (7 days before ref) → daysBetween = (June 8 - June 15) = -7 → -7 <= 7 → URGENT
- deadline = '2023-06-22' (7 days after ref) → daysBetween = 7 → 7 <= 7 → URGENT  
- deadline = '2023-06-07' (8 days before ref) → daysBetween = -8 → -8 <= 7 → URGENT (BUG!)
- deadline = '2023-06-23' (8 days after ref) → daysBetween = 8 → 8 <= 7 → NOT urgent
- No deadline → NOT urgent
- deadline = '2023-06-15' (same day) → daysBetween = 0 → 0 <= 7 → URGENT

So the boundary for "not urgent" is strictly > 7 days in the future. The boundary for "urgent" includes any past date.

For the test, let me use a consistent ref date like '2023-06-15'.

Now let me write the complete test file. This will be long but comprehensive.

Let me also think about what exact edge cases for the rate table transitions:

- `openedAt = '2020-12-31'` → 2019 table (day before REVISION_2021)
- `openedAt = '2021-01-01'` → 2021 table (exactly REVISION_2021, inclusive)
- `openedAt = '2021-06-30'` → 2021 table
- `openedAt = '2022-06-30'` → 2021 table (day before REVISION_2022)
- `openedAt = '2022-07-01'` → 2021 table (exactly REVISION_2022, but since `openedAt > REVISION_2022` is false, returns 2021)
- `openedAt = '2022-07-02'` → 2022 table (day after REVISION_2022)

These are the key boundary tests.

Now let me also think about the "band > 4" and "band < 1" edge cases:
- complexity = 0 → band = 1 (clamped up)
- complexity = -3 → band = 1 (clamped up)  
- complexity = 5 → band = 4 (clamped down)
- complexity = 1.5 → band = 1.5 → bands[0.5] = undefined → bandFee = NaN (BUG)
- complexity = null → throws
- complexity = undefined → throws

For unknown type:
- type = 'UNKNOWN' → falls back to STANDARD base rates

Let me now write the test file. I'll make it as comprehensive as possible.

Also, I need to think about: the `now` parameter is optional and when not provided, uses real time. For determinism, all tests should provide `now`.

Let me now write everything out.

For the FINDINGS.md, I need:
- Each finding with: reproducing input, what the code does, what it probably intended, blast radius, proposed fix.
- Open questions if something can't be determined.

Let me draft FINDINGS.md:

**Finding 1: Past deadlines always trigger urgency fee**
- Input: any case with a deadline more than 7 days in the past (e.g., deadline='2020-01-01', now='2023-01-15')
- Current behavior: urgency fee is charged because daysBetween returns a large negative number, which is <= 7
- Probable intent: urgency should apply only when the deadline is within 7 days (up to 7 days in the future)
- Blast radius: every historical case with an expired deadline has been overcharged urgency fees, feeding into audited historical records
- Proposed fix: change condition to `daysBetween(ref, c.deadline) >= 0 && daysBetween(ref, c.deadline) <= 7` or similar

**Finding 2: Non-integer complexity produces NaN**
- Input: complexity = 1.5
- Current behavior: band = 1.5, bands[0.5] is undefined, bandFee is undefined/NaN, total is NaN
- Probable intent: complexity should be an integer 1-4; non-integer values should be rejected or rounded
- Blast radius: any case with non-integer complexity would produce NaN fees, potentially corrupting billing records
- Proposed fix: validate complexity is an integer, or Math.floor/round it

**Finding 3: Default urgency reference uses wall clock**
- Input: no `now` parameter provided
- Current behavior: uses `new Date().toISOString().slice(0, 10)`, making results dependent on when the function runs
- Probable intent: probably should have a fixed reference or at least document this behavior
- Blast radius: same case processed at different times gets different urgency fees if near the 7-day boundary; historical calculations are non-reproducible
- Proposed fix: always require a reference date, or log which date was used

Now let me write the complete test file. I'll try to be exhaustive.

Let me think about the structure once more:

```
describe('feeCalculator', () => {
  describe('full matrix: case type × complexity band', () => {
    // 16 combinations for each rate table
  });
  
  describe('rate table selection', () => {
    // Boundary tests for both transitions
  });
  
  describe('urgency multipliers', () => {
    // Boundary at 7 days, both sides
    // Past deadlines
    // No deadline
  });
  
  describe('expited fee', () => {
    // Basic application
    // Compounding with urgency
  });
  
  describe('rounding', () => {
    // Rounding at each step
  });
  
  describe('degenerate inputs', () => {
    // Zero, negative, null, undefined complexity
    // Unknown type
    // Band > 4
  });
  
  describe('pinned quirks and bugs', () => {
    // Named tests for each finding
  });
});
```

OK let me now write the actual code. I'll compute expected values carefully.

Let me organize the matrix test. I'll pick a date in the 2021 period (e.g., '2021-06-15') and test all 16 combinations with no urgency, no expedited.

For RATE_TABLE_2021:
STANDARD: [13500, 20500, 29500, 44500]
COMMERCIAL: [24000, 34000, 48500, 73000]
ESTATE: [19500, 28000, 42500, 64500]
APPEAL: [32500, 45500, 66000, 99000]

With no deadline and no expedited, the expected total is just the bandFee.

Actually, let me reconsider the approach. Instead of asserting exact values for the matrix (which I'd have to compute very carefully), I could structure the matrix tests to verify key properties:
- The bandFee matches the expected value from the rate table
- The table name matches the expected table for the given openedAt

But the task says "behavioral coverage" — I think I need to assert actual output values. Let me just compute them.

Let me write the test file now. I'll use a helper to compute expected values to reduce errors, but compute them inline in the tests.

Actually, the simplest approach for the matrix: for each (type, band, table) combination, the expected output with no urgency and no expedited is just `{ table, bandFee, urgencyFee: 0, expeditedFee: 0, total: bandFee }`.

Let me write it.

For the full matrix, I'll test on the 2021 table (openedAt = '2021-06-15'), no deadline, no expedited. Then test the same on 2019 and 2022 tables.

Actually, to keep the test file manageable, let me do the full matrix on one table (2021) and then test the table selection separately.

Hmm, but the task says "every case type × every complexity band" — that's the matrix. It doesn't say every table × type × band. Let me test the matrix on the 2021 table (a representative one) and then test the rate table selection logic separately with its own tests.

Wait, let me re-read: "every case type × complexity band". Yes, just the case type × complexity band matrix. The rate table selection is separate.

Let me finalize the structure and write it all out.

One more consideration: the `openedAt` field affects the rate table. So for the matrix test, I need to pick a fixed `openedAt` and use it consistently. Let me use '2021-06-15' which maps to the 2021 table.

Also, for the matrix, what about urgency? If I don't provide a deadline, urgencyFee is 0 and expeditedFee is 0. That isolates the base matrix. Then I can have separate tests for urgency, expedited, and rounding.

Let me write the test file now.

```typescript
import { describe, it, expect } from 'vitest';
import { calculateFee, CaseInput, FeeBreakdown } from '../feeCalculator';

const REF_DATE = '2023-06-15';

function baseInput(overrides: Partial<CaseInput>): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2021-06-15',
    ...overrides,
  };
}

describe('feeCalculator', () => {
  
  // ============ FULL MATRIX ============
  describe('full matrix: case type × complexity band', () => {
    const caseTypes = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
    const bands = [1, 2, 3, 4] as const;
    
    // Rate table for 2021
    const rates2021 = {
      STANDARD: [13500, 20500, 29500, 44500],
      COMMERCIAL: [24000, 34000, 48500, 73000],
      ESTATE: [19500, 28000, 42500, 64500],
      APPEAL: [32500, 45500, 66000, 99000],
    };
    
    for (const type of caseTypes) {
      for (const band of bands) {
        it(`STANDARD type=${type} band=${band} (2021 table)`, () => {
          const input = baseInput({ type, complexity: band });
          const result = calculateFee(input);
          expect(result.table).toBe('2021');
          expect(result.bandFee).toBe(rates2021[type][band - 1]);
          expect(result.urgencyFee).toBe(0);
          expect(result.expeditedFee).toBe(0);
          expect(result.total).toBe(rates2021[type][band - 1]);
        });
      }
    }
    
    // Also test on 2019 and 2022 tables
    // ...
  });
```

Wait, this is getting really long with 16 × 3 = 48 tests just for the matrix across all tables. Let me be smart about this. The task says "every case type × complexity band" — I think testing on one table is sufficient for the matrix, and then testing the table selection separately covers the rate tables. Let me test on 2021 table (16 tests) for the matrix, and then have separate tests for the rate table boundaries.

Actually, let me include all three tables to be thorough. But I'll use a parameterized approach to keep it concise.

Let me just write it out now. I'll aim for clarity and completeness.

Here's my plan for the test file:

1. **Matrix on 2021 table** (16 test cases, one per type×band)
2. **Matrix on 2019 table** (16 test cases)
3. **Matrix on 2022 table** (16 test cases)
4. **Rate table boundary tests** (6 tests: both transitions, both sides)
5. **Urgency boundary tests** (4-6 tests)
6. **Expedited tests** (2-3 tests)
7. **Rounding tests** (2-3 tests)
8. **Degenerate input tests** (5-6 tests)
9. **Unknown type test** (1 test)
10. **Pinned quirks/bugs** (3 tests)

That's about 70+ tests. Let me write them.

Hmm, actually that's a lot of repetitive code. Let me use loops where possible.

OK let me just write the whole thing. I'll be systematic.

Let me compute all the boundary values for rate tables:

**Transition 1: 2019 → 2021 at REVISION_2021 = '2021-01-01'**
- '2020-12-31' → 2019 table → table: '2019'
- '2021-01-01' → 2021 table → table: '2021' (inclusive)

**Transition 2: 2021 → 2022 at REVISION_2022 = '2022-07-01'**
- '2022-06-30' → 2021 table → table: '2021'
- '2022-07-01' → 2021 table → table: '2021' (inclusive! because `openedAt > REVISION_2022` is false when openedAt === REVISION_2022)
- '2022-07-02' → 2022 table → table: '2022'

Wait, this is interesting. At exactly '2022-07-01', the code returns 2021 table. That means the transition is:
- 2021 table applies on and after 2021-01-01 through and including 2022-07-01
- 2022 table applies strictly after 2022-07-01

This is documented in the rate table comments. The finding should note this asymmetry: 2022-07-01 gets 2021 rates even though it's a 2022 revision date. This could be intentional or a bug.

OK let me write the full test file now. I'll be very detailed.

For the urgency test, I'll use a STANDARD, complexity 1 case (bandFee = 13500 for 2021, or 12000 for 2019, etc.) and manipulate the deadline relative to `now`.

Let me use RATE_TABLE_2021 STANDARD complexity 1: bandFee = 13500.
Urgency at 15%: Math.round(13500 * 15 / 100) = 2025.
No expedited: total = 13500 + 2025 = 15525.

For the "7 days exactly" test:
- now = '2023-06-15', deadline = '2023-06-22' (exactly 7 days later) → urgent
- now = '2023-06-15', deadline = '2023-06-23' (exactly 8 days later) → not urgent

For the "7 days in the past" test:
- now = '2023-06-15', deadline = '2023-06-08' (exactly 7 days earlier) → urgent (because -7 <= 7)

For the "8 days in the past" test:
- now = '2023-06-15', deadline = '2023-06-07' (exactly 8 days earlier) → urgent (BUG: -8 <= 7)

For the "100 days in the past" test (demonstrating the bug):
- now = '2023-06-15', deadline = '2023-03-07' (100 days earlier) → urgent (BUG: -100 <= 7)

For no deadline: not urgent.

Now expedited:
- bandFee = 13500, urgencyFee = 2025, expeditedPct = 12%
- expeditedFee = Math.round((13500 + 2025) * 12 / 100) = Math.round(15525 * 0.12) = Math.round(1863) = 1863
- total = 13500 + 2025 + 1863 = 17388

Rounding test - let me find a case where rounding matters:
- COMMERCIAL, band 2, RATE_TABLE_2021: bandFee = 34000
- Urgency (15%): Math.round(34000 * 15 / 100) = Math.round(5100) = 5100 → exact, no rounding needed
- Let me find a case that actually needs rounding...

RATE_TABLE_2019 STANDARD band 2: bandFee = 18500
Urgency (15%): Math.round(18500 * 15 / 100) = Math.round(2775) = 2775 → exact

Hmm, most of these are exact. Let me look for one that isn't.

RATE_TABLE_2022 ESTATE band 3: bandFee = 47000
Urgency (18%): Math.round(47000 * 18 / 100) = Math.round(8460) = 8460 → exact

Let me think... urgencyPct is 15% or 18%. 15% of anything ending in 000 is exact. But what about non-round numbers?

Actually, all base fees are multiples of 500. 15% of 500 = 75, which is an integer. 18% of 500 = 90, which is an integer. So 15% and 18% of any multiple of 500 gives an integer. Let me check: 15% of 12000 = 1800. 15% of 18500 = 2775. 18% of 15000 = 2700. All exact.

What about expeditedPct? 10% and 12% of amounts. 10% of anything is exact (just move decimal). 12% of (bandFee + urgencyFee)... let me check: 12% of (12000 + 1800) = 12% of 13800 = 1656. Exact.

Hmm, so maybe all the rates produce exact results with the given numbers. Let me check a few more...

12% of 13500 = 1620. Exact. 12% of (13500 + 2025) = 12% of 15525 = 1863. Exact.

OK, it seems like the numbers were chosen to always produce exact results. So rounding may not actually change any values. But the code DOES round (Math.round is called), and the comment says "rounded at each step since 2019; billing reconciles against these." The test should still demonstrate that rounding is applied — even if the current data happens to produce exact results, the behavior of rounding at each step (not just at the end) should be pinned.

Actually, I should test that rounding IS applied. For example, if we could find a case where not rounding would give a different result... But with these numbers, everything is exact.

Let me test that rounding happens at each step specifically:
- Expedited fee is computed on (bandFee + urgencyFee), not on bandFee alone.
- This means rounding urgencyFee first, then computing expedited on the rounded value, is the behavior.

Let me construct a test that demonstrates this:
- With urgencyFee applied, expeditedFee = pctOf(bandFee + urgencyFee, expeditedPct)
- If urgencyFee were NOT applied, expeditedFee = pctOf(bandFee, expeditedPct)

For STANDARD band 1, RATE_TABLE_2021:
- With urgency: expedited = Math.round((13500 + 2025) * 12 / 100) = Math.round(1863) = 1863
- Without urgency: expedited = Math.round(13500 * 12 / 100) = Math.round(1620) = 1620

The test should show that expedited is computed on (bandFee + urgencyFee), which includes the rounded urgencyFee.

For the rounding test, I can pick a specific case and verify the intermediate values:
- Case: STANDARD, band 1, RATE_TABLE_2021, urgent + expedited
- Expected: bandFee=13500, urgencyFee=2025, expeditedFee=1863, total=17388

This demonstrates that:
1. Urgency is rounded (Math.round applied)
2. Expedited is computed on rounded urgencyFee + bandFee
3. Total is sum of unrounded components

Now let me also think about the "rounding at each step" requirement more carefully. The task says: "rounding at each step — where it happens, and whether it happens more than once." So I need to test that:
1. pctOf uses Math.round (rounding happens for urgency)
2. pctOf uses Math.round (rounding happens for expedited)
3. Both are rounded independently (rounding happens more than once)
4. Expedited is computed on rounded urgency fee (not the raw percentage)

Let me pick a test case where the math is clean enough to show the step-by-step:

STANDARD, complexity 1, RATE_TABLE_2021, urgent, expedited:
Step 1: bandFee = 13500 (no rounding needed, it's a base rate)
Step 2: urgencyFee = Math.round(13500 * 15 / 100) = Math.round(2025) = 2025
Step 3: expeditedFee = Math.round((13500 + 2025) * 12 / 100) = Math.round(15525 * 12 / 100) = Math.round(1863) = 1863
Step 4: total = 13500 + 2025 + 1863 = 17388

This shows rounding happens at two separate steps (urgency and expedited).

Now, for a case where the numbers don't work out to integers... Actually, let me try to find one. Let me try some odd number.

Hmm, all base fees are multiples of 500. Let me try complexity that's been clamped:
- complexity = 0, which maps to band 1
- complexity = 5, which maps to band 4

But these use the same base rates. Let me try with different rate tables...

RATE_TABLE_2019 COMMERCIAL band 3: 45000
Urgency (15%): 6750 (exact)
Expedited (10% of 45000 + 6750 = 51750): 5175 (exact)

Hmm. All the base rates are multiples of 500, and 10%, 12%, 15%, 18% of multiples of 500 are all integers. So there's no "interesting" rounding case in the current data.

But I should still test it. The characterization test pins what happens, even if it happens to be exact. I'll write a test that verifies the rounding function behavior with a direct check (e.g., compute a value that would be fractional without rounding and verify it gets rounded).

Actually, I realize I can test the `pctOf` behavior indirectly by finding a case where the percentage would produce a non-integer. Let me think...

Wait, what about with the bug scenario? If a past deadline triggers urgency for a case that shouldn't have it, the fee would be different. But that's already a finding.

Let me just write a test that verifies the rounding happens. I can use a case where I manually compute the expected values showing Math.round is applied.

Actually, let me try to find a case where Math.round matters. What if I use a date that selects a different table and the base rates work out differently?

All base rates are multiples of 500, and all percentages (10%, 12%, 15%, 18%) of multiples of 500 produce integers. So Math.round is always a no-op with the current data. But the code clearly uses Math.round, and the comment says "rounded at each step since 2019." The characterization test should document this behavior — even if it's currently a no-op.

I'll write a test that asserts the intermediate values are integers (proving rounding is applied), and documents that the current data happens to produce exact values.

Actually, a cleaner approach: I can create a test that specifically shows the two-stage rounding by using the "expedited fee depends on already-rounded urgency fee" behavior. Even though the values are exact, the key behavior is that expedited fee is computed on (bandFee + urgencyFee) where urgencyFee is ALREADY rounded, not computed from raw percentage.

If we didn't round urgency first, then expedited would be:
Math.round(bandFee * 1.15 * 12 / 100) — different from
Math.round((bandFee + Math.round(bandFee * 15 / 100)) * 12 / 100)

In current data these happen to be the same, but the BEHAVIOR is different. The test should pin the actual behavior:

```typescript
it('rounding happens at each step (urgency rounded before expedited computed)', () => {
  const input = baseInput({ type: 'STANDARD', complexity: 1, deadline: '2023-06-22', expedited: true });
  const result = calculateFee(input, REF_DATE);
  // urgencyFee = Math.round(13500 * 15 / 100) = 2025
  expect(result.urgencyFee).toBe(2025);
  // expeditedFee = Math.round((13500 + 2025) * 12 / 100) = 1863
  expect(result.expeditedFee).toBe(1863);
  expect(result.total).toBe(17388);
});
```

This pins the fact that rounding happens at both steps, and expedited uses the rounded urgency fee.

OK, I think I have a good understanding now. Let me write the complete test file and FINDINGS.md.

One more thing: the task says the test file should be deterministic with no real dates. All my tests use the `now` parameter.

Let me also consider: should I use `beforeEach` with a fixed date? No, each test should be self-contained.

Let me now write the actual files.

Actually, I realize I should double-check: the `deadline` field is optional (`deadline?: string`). When it's not provided, urgency is not charged. When provided, the daysBetween check applies.

Also, `expedited?: boolean` — when true, expedited fee is charged.

And one more thing: the `now` parameter — it's `now?: string`. When provided, it's used as the reference date. When not provided, the code uses `new Date().toISOString().slice(0, 10)`.

Now let me finalize and write everything.

Let me structure the FINDINGS.md clearly:

```markdown
# FINDINGS.md — feeCalculator.ts

## F-01: Past deadlines always trigger urgency fee [BUG]
...

## F-02: Non-integer complexity produces NaN [BUG]
...

## F-03: Default urgency reference uses wall clock [QUIRK]
...

## F-04: Rate table transition at 2022-07-01 is asymmetric [QUIRK]
...
```

Wait, let me think about F-04. At exactly '2022-07-01', the code returns the 2021 table, not the 2022 table. The comment says "2022-07: rate revision" and the constant is REVISION_2022 = '2022-07-01'. So the intention might be that from 2022-07-01, the 2022 rates should apply. But the code says `if (openedAt > REVISION_2022)`, which excludes exactly 2022-07-01. This means cases opened on 2022-07-01 get 2021 rates, not 2022 rates. This could be a bug.

This is an important finding. Let me include it.

Now, let me also think about the `openedAt >= REVISION_2021` check. At exactly '2021-01-01', the code returns 2021 table. This is an inclusive left boundary. This is probably intentional — the revision date is when the new rates start.

Let me now finalize everything and write it out.

For the test, let me carefully compute all expected values. I'll organize them by section.

Here's my final plan for the test file:

```typescript
import { describe, it, expect } from 'vitest';
import { calculateFee, CaseInput } from '../feeCalculator';

describe('feeCalculator', () => {
  
  describe('full matrix: case type × complexity band', () => {
    // Test all 16 combinations on 2021, 2019, and 2022 tables
    // With no deadline and no expedited (isolates base fee)
    // Also test with urgency and expedited for at least a few combinations
  });
  
  describe('rate table selection — boundaries', () => {
    // Test all boundary dates for both transitions
  });
  
  describe('urgency multipliers', () => {
    // Deadline exactly 7 days in future → urgent
    // Deadline exactly 8 days in future → not urgent  
    // Deadline exactly 7 days in past → urgent (pinned)
    // Deadline 100 days in past → urgent (pinned bug)
    // No deadline → not urgent
    // Deadline same day → urgent
  });
  
  describe('expedited fee', () => {
    // Expedited applied
    // Expedited computed on bandFee + urgencyFee
  });
  
  describe('rounding', () => {
    // Rounding at urgency step
    // Rounding at expedited step
    // Two-stage rounding (expedited uses rounded urgency)
  });
  
  describe('degenerate inputs', () => {
    // complexity = 0 → clamped to 1
    // complexity = -3 → clamped to 1
    // complexity = 5 → clamped to 4
    // complexity = null → throws
    // complexity = undefined → throws
    // unknown type → falls back to STANDARD
  });
  
  describe('pinned quirks and bugs', () => {
    // Past deadlines trigger urgency (bug)
    // Non-integer complexity → NaN (bug)
    // Wall clock default (quirk)
    // Asymmetric 2022-07-01 boundary (quirk)
  });
});
```

Let me write it all out now. I'll be precise with the expected values.

Wait, I want to verify one more thing about the `daysBetween` function:

```typescript
function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / 86400000);
}
```

So `daysBetween(ref, deadline)` = Math.floor((deadline - ref) / 86400000).

If ref = '2023-06-15' and deadline = '2023-06-22':
- new Date('2023-06-22').getTime() - new Date('2023-06-15').getTime() = 7 * 86400000
- Math.floor(7 * 86400000 / 86400000) = Math.floor(7) = 7

If ref = '2023-06-15' and deadline = '2023-06-08':
- negative: -7 * 86400000
- Math.floor(-7) = -7

If ref = '2023-06-15T12:00:00Z' and deadline = '2023-06-22T06:00:00Z':
- Hmm, but in the code, `now` is sliced to just the date part: `new Date().toISOString().slice(0, 10)`. So `ref` would be something like '2023-06-15'. And the deadline is also a date like '2023-06-22'. So both are date-only strings.

But wait, `new Date('2023-06-15')` — what time does this parse to? In JavaScript, `new Date('2023-06-15')` parses as UTC midnight: 2023-06-15T00:00:00Z. And `new Date('2023-06-22')` is 2023-06-22T00:00:00Z. So the difference is exactly 7 days.

But what about timezone issues? If the user's local timezone is not UTC, `new Date('2023-06-15')` might be interpreted differently. In modern browsers and Node.js, ISO date strings without time are treated as UTC. So it should be consistent.

Actually, wait. In some JavaScript environments, `new Date('2023-06-15')` is interpreted as LOCAL time, not UTC. And `toISOString().slice(0, 10)` gives the UTC date. So there could be a mismatch if the local timezone is behind UTC. For example, in US Eastern time (UTC-5), `new Date('2023-06-15')` would be June 15 at midnight local = June 15 at 05:00 UTC. And `now` would be the UTC date, say '2023-06-14' if it's before midnight UTC. This could cause off-by-one issues.

But for our characterization tests, we use `now` parameter which is passed as a string like '2023-06-15', and deadlines are also date strings. Both go through `new Date()` in `daysBetween`. So they're treated the same way. The key is that the tests are deterministic because we always pass both `now` and `deadline` as date strings.

However, the `tableFor` function compares `openedAt` directly as strings (using `>=` and `>`). Since `openedAt` is an ISO date string like '2021-06-15', string comparison works correctly.

One more thing: the `openedAt` field in `CaseInput` is a string, not used in date arithmetic. Only the deadline comparison uses date arithmetic.

OK, I'm confident now. Let me write the final test file.

Let me also think about one more edge: what happens when `complexity` is a float like 2.5?
- `band = c.complexity` → 2.5
- `!band` → false (2.5 is truthy)
- `band < 1` → false
- `band > 4` → false
- So `band = 2.5`
- `bands[2.5 - 1]` = `bands[1.5]` → undefined
- `bandFee = undefined`
- In the total: `undefined + 0 + 0` = NaN

This is definitely a bug. Non-integer complexity produces NaN.

Now let me also consider: what if `complexity` is `NaN`? `!NaN` is true, so band would be set to 1. But `NaN` is a number, so it wouldn't trigger the null/undefined check. Interesting edge case.

What about `complexity` being a string like `"2"`? The type says `number | null`, but since `type: string` is "historically not validated upstream, so string", maybe complexity could be a string too. But the type system says number | null, so let's not go there.

What about `openedAt` being an invalid date string? `tableFor` does string comparison, which would give unexpected results but wouldn't throw.

What about `deadline` being an invalid date string? `new Date(invalid).getTime()` returns NaN, and NaN <= 7 is false. So urgency would not be charged.

OK, I think I've covered all the edge cases. Let me write the files now.

One more thing about the matrix: should I also test the matrix with urgency and expedited combined? The task says "every case type × complexity band" — I think the base matrix (no urgency, no expedited) is the primary matrix. Then urgency and expedited are tested separately. But to be thorough, I could add a few matrix entries with urgency and expedited.

Actually, let me include:
1. Base matrix (no deadline, no expedited) - all 16 combinations × 3 tables = 48 tests (or 16 with a parameterized approach)
2. Matrix with urgency only - a subset
3. Matrix with urgency + expedited - a subset

Or I could do:
1. Base matrix for 2021 (16 tests)
2. Base matrix for 2019 (16 tests)  
3. Base matrix for 2022 (16 tests)
4. One full matrix row with urgency + expedited for each type (4 tests)
5. Table selection (6 tests)
6. Urgency (6 tests)
7. Expedited (2 tests)
8. Rounding (2 tests)
9. Degenerate (6 tests)
10. Quirks/bugs (4 tests)

That's about 96 tests. That's a lot but comprehensive.

Let me be practical and use parameterized/describe-table style where possible to reduce code volume while maintaining coverage.

Actually, I'll use a loop-based approach for the matrix to keep the code DRY:

```typescript
const allTypes = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
const allBands = [1, 2, 3, 4] as const;

for (const tableKey of ['2019', '2021', '2022'] as const) {
  for (const type of allTypes) {
    for (const band of allBands) {
      it(`${tableKey}: ${type} band ${band}`, () => {
        // ...
      });
    }
  }
}
```

This gives 48 tests with minimal code.

OK let me write it all out now. I'll aim for a complete, working test file.

Let me finalize my understanding of the test for the matrix with urgency and expedited. I'll do one representative case for each type to demonstrate the full fee computation:

For each type, complexity 1, RATE_TABLE_2021, with urgency and expedited:
- STANDARD: bandFee=13500, urgency=2025, expedited=1863, total=17388
- COMMERCIAL: bandFee=24000, urgency=Math.round(24000*15/100)=3600, expedited=Math.round((24000+3600)*12/100)=Math.round(3312)=3312, total=30912
- ESTATE: bandFee=19500, urgency=Math.round(19500*15/100)=2925, expedited=Math.round((19500+2925)*12/100)=Math.round(2697)=2697, total=25122
- APPEAL: bandFee=32500, urgency=Math.round(32500*15/100)=4875, expedited=Math.round((32500+4875)*12/100)=Math.round(4485)=4485, total=41860

Let me double-check COMMERCIAL: 24000 * 15 / 100 = 3600. (24000+3600) * 12 / 100 = 27600 * 0.12 = 3312. Total = 24000 + 3600 + 3312 = 30912. ✓

ESTATE: 19500 * 0.15 = 2925. (19500+2925) * 0.12 = 22425 * 0.12 = 2691. Wait: 22425 * 12 / 100 = 269100 / 100 = 2691. So expedited = 2691, not 2697. Let me recompute: 19500 + 2925 = 22425. 22425 * 12 = 269100. 269100 / 100 = 2691. So expeditedFee = 2691. Total = 19500 + 2925 + 2691 = 25116.

Let me re-verify more carefully:
- STANDARD band 1, 2021: bandFee = 13500
  - urgency = round(13500 * 15 / 100) = round(2025) = 2025
  - expedited = round((13500 + 2025) * 12 / 100) = round(15525 * 12 / 100) = round(1863) = 1863
  - total = 13500 + 2025 + 1863 = 17388 ✓

- COMMERCIAL band 1, 2021: bandFee = 24000
  - urgency = round(24000 * 15 / 100) = round(3600) = 3600
  - expedited = round((24000 + 3600) * 12 / 100) = round(27600 * 12 / 100) = round(3312) = 3312
  - total = 24000 + 3600 + 3312 = 30912 ✓

- ESTATE band 1, 2021: bandFee = 19500
  - urgency = round(19500 * 15 / 100) = round(2925) = 2925
  - expedited = round((19500 + 2925) * 12 / 100) = round(22425 * 12 / 100) = round(2691) = 2691
  - total = 19500 + 2925 + 2691 = 25116

- APPEAL band 1, 2021: bandFee = 32500
  - urgency = round(32500 * 15 / 100) = round(4875) = 4875
  - expedited = round((32500 + 4875) * 12 / 100) = round(37375 * 12 / 100) = round(4485) = 4485
  - total = 32500 + 4875 + 4485 = 41860

Great. Now for RATE_TABLE_2019, same type band 1:
- STANDARD: bandFee = 12000
  - urgency (15%) = round(12000 * 15 / 100) = 1800
  - expedited (10%) = round((12000 + 1800) * 10 / 100) = round(1380) = 1380
  - total = 12000 + 1800 + 1380 = 15180

- COMMERCIAL: bandFee = 22000
  - urgency (15%) = round(22000 * 15 / 100) = 3300
  - expedited (10%) = round((22000 + 3300) * 10 / 100) = round(2530) = 2530
  - total = 22000 + 3300 + 2530 = 27830

- ESTATE: bandFee = 18000
  - urgency (15%) = round(18000 * 15 / 100) = 2700
  - expedited (10%) = round((18000 + 2700) * 10 / 100) = round(2070) = 2070
  - total = 18000 + 2700 + 2070 = 22770

- APPEAL: bandFee = 30000
  - urgency (15%) = round(30000 * 15 / 100) = 4500
  - expedited (10%) = round((30000 + 4500) * 10 / 100) = round(3450) = 3450
  - total = 30000 + 4500 + 3450 = 37950

And RATE_TABLE_2022, band 1:
- STANDARD: bandFee = 15000
  - urgency (18%) = round(15000 * 18 / 100) = 2700
  - expedited (12%) = round((15000 + 2700) * 12 / 100) = round(2124) = 2124
  - total = 15000 + 2700 + 2124 = 19824

- COMMERCIAL: bandFee = 26500
  - urgency (18%) = round(26500 * 18 / 100) = round(4770) = 4770
  - expedited (12%) = round((26500 + 4770) * 12 / 100) = round(3740.4) = 3740
  - total = 26500 + 4770 + 3740 = 35010

Wait: (26500 + 4770) * 12 / 100 = 31270 * 12 / 100 = 375240 / 100 = 3752.4. Math.round(3752.4) = 3752. Total = 26500 + 4770 + 3752 = 35022.

Let me recompute: 31270 * 12 = 375240. 375240 / 100 = 3752.4. Math.round(3752.4) = 3752. ✓

- ESTATE: bandFee = 21500
  - urgency (18%) = round(21500 * 18 / 100) = round(3870) = 3870
  - expedited (12%) = round((21500 + 3870) * 12 / 100) = round(25370 * 12 / 100) = round(3044.4) = 3044
  - total = 21500 + 3870 + 3044 = 28414

- APPEAL: bandFee = 36000
  - urgency (18%) = round(36000 * 18 / 100) = round(6480) = 6480
  - expedited (12%) = round((36000 + 6480) * 12 / 100) = round(42480 * 12 / 100) = round(5097.6) = 5098
  - total = 36000 + 6480 + 5098 = 47578

These values are useful for tests. But I won't compute the entire 48-test matrix for all three tables with urgency+expedited. I'll just do the base matrix (no urgency, no expedited) for all 48 combinations, and then a few targeted tests for urgency+expedited.

OK let me write the code now. For real this time.

Let me think about the file structure. The task says "Decide the file layout yourself." So I'll put:
- `test/feeCalculator.spec.ts` — the characterization suite
- `FINDINGS.md` — findings document

Both at the workspace root.

Now, the test file: let me also make sure I import correctly. Since it's ESM and the project uses TypeScript, the import from `../feeCalculator` should work (the file is at the workspace root, test is in a subdirectory).

Let me now write the complete test file. I'll be very thorough.

Hmm, one more consideration: should I create a `vitest.config.ts`? The task mentions vitest, and the existing project has a tsconfig.json. I don't think I need to create a vitest config — it's reasonable to assume one exists or will be set up. But if tests need to run, there might need to be one. Let me include a minimal vitest config since it's necessary for the tests to actually run.

Actually, the task says "Deliver: the suite + FINDINGS.md." So just those two files. If there's a vitest config already, great. If not, the test suite is still valid — it just needs a config to run. Let me not create it unless needed.

Wait, but I also need to make sure the import path is correct. `feeCalculator.ts` is at the workspace root. If the test file is at `test/feeCalculator.spec.ts`, the import would be `../feeCalculator`. But if the workspace layout is different... Let me check the reference. The feeCalculator.ts is shown at `runs/inclusionai-ling-3.0-flash--ladder/variant-a-single/workspace/feeCalculator.ts`. So it's in a "workspace" directory. And the test would be in a "test" subdirectory.

For my deliverable, I'll put both files at the same level as feeCalculator.ts (workspace root). So the import path from `test/feeCalculator.spec.ts` would be `../feeCalculator`.

But wait, I should also consider: maybe the test file should be alongside the source file, like `test/feeCalculator.spec.ts` next to `feeCalculator.ts`? Or in a `__tests__` directory? The task doesn't specify. Let me use `test/feeCalculator.spec.ts` which is a common convention.

OK let me write it now. For real.

Let me also consider what tsconfig.json the test needs. The existing one has `"include": ["*.ts"]` which only includes root-level TypeScript files. For a `test/` directory, I'd need to update this or create a separate config. But since I'm not modifying the production code or tsconfig (per task constraints), I'll just note that the test file needs to be compatible with the build setup.

Actually, the task says "Production code is byte-identical to what it is now" — this means I shouldn't modify feeCalculator.ts. It doesn't say I can't modify tsconfig. But modifying tsconfig isn't called for either. Let me just create the test file and FINDINGS.md.

Let me now write everything. I'll structure the test file with clear describe/it blocks and comprehensive assertions.

Final note: the task says "Coverage is judged behaviorally — a high-percentage suite with hollow assertions fails." So my assertions must be specific and behavioral, checking actual output values.

Here we go:

```typescript
// test/feeCalculator.spec.ts
import { describe, it, expect } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput } from '../feeCalculator';

// Reference dates for deterministic testing
const REF_2019 = '2019-06-15';
const REF_2021 = '2021-06-15';
const REF_2022 = '2023-06-15';
```

Wait, the `now` parameter is what determines the urgency calculation reference date. The `openedAt` determines the rate table. So I need to be clear about which is which.

For matrix tests (testing base fees by type and band), I want to control the rate table via `openedAt` and avoid urgency/expedited (no deadline, no expedited). The `now` parameter is irrelevant when there's no deadline.

For urgency tests, I control both `now` (reference date) and `deadline` (case deadline).

Let me write it out now. I'll use loops for the matrix tests.

Actually, let me think about the `now` parameter one more time. In the code:

```typescript
const ref = now ? now : new Date().toISOString().slice(0, 10);
```

So `now` is expected to be a date string in 'YYYY-MM-DD' format (since it's compared with `deadline` via `daysBetween`, which uses `new Date()`).

For the tests, I'll always provide `now` as a 'YYYY-MM-DD' string.

Now let me write the complete test file. I'll aim for about 100-120 tests that cover everything required.

Actually let me also think about a subtle point: the `openedAt` in `CaseInput` is a string that goes through `tableFor()` which does string comparison. But what if `openedAt` is malformed? The string comparison would still work (alphabetically), but the results would be nonsensical. I should probably not test malformed `openedAt` since it's not mentioned as a degenerate input.

The degenerate inputs mentioned are: zero, negative, unknown case type. And from the code: complexity (zero, negative, null, undefined), type (unknown). Let me also cover band > 4.

OK here's my final structure. Let me write the file now.

Let me also think about test naming. The task says "name the test so a reader knows" for pinned quirks/bugs. For example: "PINNED BUG: past deadline always triggers urgency fee".

Alright, let me produce the complete deliverable.

I'll also need to consider: does the test import need to be `import { calculateFee } from '../feeCalculator'` or `from '../feeCalculator.ts'`? In TypeScript with ESM and `"moduleResolution": "bundler"`, both should work, but typically you omit the `.ts` extension. Let me use `from '../feeCalculator'` as that's the conventional import.

Wait, but vitest with ts-node or similar might need the `.ts` extension in some configurations. With `"moduleResolution": "bundler"`, extension-less imports should work. Let me use extension-less.

One more thing: I should check if there are any issues with `new Date().toISOString().slice(0, 10)` in the code. When `now` is not provided, this is called inside the `calculateFee` function. For determinism, all my tests should provide `now`. But in my "default behavior" quirk finding, I should test what happens WITHOUT `now` — but this would make the test non-deterministic! So the quirk finding about wall clock should be documented in FINDINGS.md but NOT tested in the suite (since the suite must be deterministic).

Wait, but the task says I should "pin" the behavior. How do I pin non-deterministic behavior? I can test it WITH a specific `now` value and document that the default (no `now`) uses the wall clock. That way the test is deterministic, and the finding documents the default behavior.

OK let me finalize. For the wall clock quirk, I'll just document it in FINDINGS.md and not create a test for it (since you can't pin non-deterministic behavior in a deterministic suite).

Now, let me write the complete test file.

Let me also re-examine the code for any other quirks:

1. `tableFor` uses string comparison on ISO dates, which works correctly for 'YYYY-MM-DD' format.
2. `daysBetween` uses `new Date(b).getTime() - new Date(a).getTime()` and `Math.floor(ms / 86400000)`. This can produce off-by-one errors near midnight in different timezones. But since we use `now` parameter and ISO date strings, it should be consistent.
3. The `pctOf` function uses `Math.round`, which rounds 0.5 up (away from zero in JavaScript). Actually, `Math.round(0.5)` = 1, `Math.round(-0.5)` = 0, `Math.round(1.5)` = 2. Standard rounding.
4. The `bandFee` is not rounded — it's directly from the rate table. Only percentage-based fees are rounded.
5. `table` name is determined by reference equality check (`table === RATE_TABLE_2022`), which works since `tableFor` returns the constant objects.

Any other quirks? Let me look...

6. The `deadline` field is optional but if provided as an empty string, `new Date('')` returns Invalid Date, and `getTime()` returns NaN. NaN <= 7 is false, so urgency would NOT be triggered. This is an edge case but probably not worth testing.

7. What if `c.openedAt` is malformed? `tableFor` does string comparison, which would give unexpected results but no error. Not a specific test target.

8. The `expedited` field: `if (c.expedited)` — if `expedited` is `undefined` (not provided), this is false. If it's `true`, urgency applies. If it's `false`, no. This is straightforward.

I think I've covered everything. Let me write the files now.

One more thing: I want to make sure the test file has proper ESM imports and is compatible with vitest. Since the project has `"type": "module"` (from the conventions), imports should use ESM syntax.

Also, vitest needs to be able to resolve the import from `../feeCalculator`. Since `feeCalculator.ts` exports `calculateFee`, `CaseInput`, `FeeBreakdown`, etc., the import should work.

Let me now write the files. I'll start with the test file.

Let me be practical about the test file length. I want to be comprehensive but not excessively verbose. I'll use helper functions and loops to generate tests.

Here's the test file:

```typescript
import { describe, it, expect } from 'vitest';
import { calculateFee } from '../feeCalculator';

// ============ CONSTANTS ============

// Rate table data mirrored for assertion clarity (not used to compute — tests read behavior)
const TABLE_2019_OPENED = '2020-06-15'; // < 2021-01-01 → 2019 table
const TABLE_2021_OPENED = '2021-06-15'; // >= 2021-01-01, ≤ 2022-07-01 → 2021 table
const TABLE_2022_OPENED = '2023-06-15'; // > 2022-07-01 → 2022 table

// All case types
const TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;

// Base fees per (table, type, band) — pinned from rate table constants
// Used only to assert expected behavior, not to compute it
const BASE_FEES: Record<string, Record<string, number[]>> = {
  '2019': {
    STANDARD: [12000, 18500, 27000, 41000],
    COMMERCIAL: [22000, 31500, 45000, 68000],
    ESTATE: [18000, 26000, 39500, 60000],
    APPEAL: [30000, 42000, 61000, 92000],
  },
  '2021': {
    STANDARD: [13500, 20500, 29500, 44500],
    COMMERCIAL: [24000, 34000, 48500, 73000],
    ESTATE: [19500, 28000, 42500, 64500],
    APPEAL: [32500, 45500, 66000, 99000],
  },
  '2022': {
    STANDARD: [15000, 22500, 32500, 49000],
    COMMERCIAL: [26500, 37500, 53500, 80500],
    ESTATE: [21500, 31000, 47000, 71000],
    APPEAL: [36000, 50000, 72500, 109000],
  },
};

const REF = '2023-06-15';

// ============ FULL MATRIX: case type × complexity band ============

describe('feeCalculator — full matrix: case type × complexity band', () => {
  for (const table of ['2019', '2021', '2022'] as const) {
    const openedAt =
      table === '2019' ? TABLE_2019_OPENED : table === '2021' ? TABLE_2021_OPENED : TABLE_2022_OPENED;
    for (const type of TYPES) {
      for (const band of [1, 2, 3, 4] as const) {
        it(`${table} table: ${type} band ${band} (no urgency, no expedited)', () => {
          const result = calculateFee(
            { type, complexity: band, openedAt },
            REF,
          );
          expect(result.table).toBe(table);
          expect(result.bandFee).toBe(BASE_FEES[table][type][band - 1]);
          expect(result.urgencyFee).toBe(0);
          expect(result.expeditedFee).toBe(0);
          expect(result.total).toBe(BASE_FEES[table][type][band - 1]);
        });
      }
    }
  }
});
```

Wait, I just realized there could be a TypeScript issue with the `as const` assertions and `for...of` loops. Let me make sure the types work.

Also, `TYPES` includes 4 strings, and iterating over them should work fine. The `band` loop iterates over `[1, 2, 3, 4]`.

But `for (const table of ['2019', '2021', '2022'] as const)` — TypeScript might complain about the type of `table` in the loop. Let me just use `for (const table of ['2019', '2021', '2022'])` and let TypeScript infer the type.

Also, I need to make sure `BASE_FEES` has the right type. Let me define it more carefully:

```typescript
const BASE_FEES = {
  '2019': {
    STANDARD: [12000, 18500, 27000, 41000],
    ...
  },
  ...
} as const;
```

Actually, for simplicity, let me just use a regular object and let TypeScript infer the type. The assertions should work.

Let me now write the complete file. I'll keep it practical and make sure it compiles.

Here's the complete test file:

```typescript
import { describe, it, expect } from 'vitest';
import { calculateFee } from '../feeCalculator';

const REF = '2023-06-15';
const OPENED_2019 = '2020-06-15';
const OPENED_2021 = '2021-06-15';
const OPENED_2022 = '2023-06-15';

const TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
type CaseType = (typeof TYPES)[number];

const BASE_FEES_2019: Record<CaseType, number[]> = {
  STANDARD: [12000, 18500, 27000, 41000],
  COMMERCIAL: [22000, 31500, 45000, 68000],
  ESTATE: [18000, 26000, 39500, 60000],
  APPEAL: [30000, 42000, 61000, 92000],
};
const BASE_FEES_2021: Record<CaseType, number[]> = {
  STANDARD: [13500, 20500, 29500, 44500],
  COMMERCIAL: [24000, 34000, 48500, 73000],
  ESTATE: [19500, 28000, 42500, 64500],
  APPEAL: [32500, 45500, 66000, 99000],
};
const BASE_FEES_2022: Record<CaseType, number[]> = {
  STANDARD: [15000, 22500, 32500, 49000],
  COMMERCIAL: [26500, 37500, 53500, 80500],
  ESTATE: [21500, 31000, 47000, 71000],
  APPEAL: [36000, 50000, 72500, 109000],
};

// ============ 1. FULL MATRIX ============

describe('full matrix: case type × complexity band (no urgency, no expedited)', () => {
  for (const table of ['2019', '2021', '2022'] as const) {
    const openedAt = table === '2019' ? OPENED_2019 : table === '2021' ? OPENED_2021 : OPENED_2022;
    const baseFees = table === '2019' ? BASE_FEES_2019 : table === '2021' ? BASE_FEES_2021 : BASE_FEES_2022;

    for (const type of TYPES) {
      for (const band of [1, 2, 3, 4] as const) {
        it(`${table}: ${type} band ${band}`, () => {
          const result = calculateFee({ type, complexity: band, openedAt }, REF);
          expect(result.table).toBe(table);
          expect(result.bandFee).toBe(baseFees[type][band - 1]);
          expect(result.urgencyFee).toBe(0);
          expect(result.expeditedFee).toBe(0);
          expect(result.total).toBe(baseFees[type][band - 1]);
        });
      }
    }
  }
});
```

Hmm wait, `openedAt` doesn't actually need to be a specific date for the matrix test — it just determines which rate table is used. But it doesn't affect the base fee calculation (only the table selection does). So using '2020-06-15' for 2019, '2021-06-15' for 2021, and '2023-06-15' for 2022 is correct.

But wait — does `openedAt` affect anything else? Looking at the code... no, it only affects `tableFor(openedAt)`. The `calculateFee` function doesn't use `openedAt` for anything else. Good.

Let me continue with the other test sections.

For the rate table boundary tests:

```typescript
describe('rate table selection — boundary dates', () => {
  it('2019→2021 transition: 2020-12-31 → 2019 (day before inclusive)', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2020-12-31' }, REF);
    expect(result.table).toBe('2019');
  });

  it('2019→2021 transition: 2021-01-01 → 2021 (inclusive)', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2021-01-01' }, REF);
    expect(result.table).toBe('2021');
  });

  it('2021→2022 transition: 2022-06-30 → 2021 (day before)', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-06-30' }, REF);
    expect(result.table).toBe('2021');
  });

  it('2021→2022 transition: 2022-07-01 → 2021 (inclusive on REVISION_2022 — pinned quirk)', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, REF);
    expect(result.table).toBe('2021');
  });

  it('2021→2022 transition: 2022-07-02 → 2022 (exclusive)', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-02' }, REF);
    expect(result.table).toBe('2022');
  });
});
```

For urgency:

```typescript
describe('urgency multipliers', () => {
  // STANDARD band 1, 2021 table: bandFee = 13500, urgency 15% = 2025

  it('deadline exactly 7 days in the future → urgent', () => {
    const result = calculateFee(
      { type: 'STANDARD', complexity: 1, openedAt: OPENED_2021, deadline: '2023-06-22' },
      REF,
    );
    expect(result.urgencyFee).toBe(2025);
    expect(result.total).toBe(13500 + 2025);
  });

  it('deadline exactly 8 days in the future → NOT urgent', () => {
    const result = calculateFee(
      { type: 'STANDARD', complexity: 1, openedAt: OPENED_2021, deadline: '2023-06-23' },
      REF,
    );
    expect(result.urgencyFee).toBe(0);
    expect(result.total).toBe(13500);
  });

  it('deadline exactly 7 days in the past → urgent', () => {
    const result = calculateFee(
      { type: 'STANDARD', complexity: 1, openedAt: OPENED_2021, deadline: '2023-06-08' },
      REF,
    );
    expect(result.urgencyFee).toBe(2025);
  });

  it('PINNED BUG: deadline 100 days in the past → urgent (past deadlines always trigger urgency)', () => {
    const result = calculateFee(
      { type: 'STANDARD', complexity: 1, openedAt: OPENED_2021, deadline: '2023-03-07' },
      REF,
    );
    expect(result.urgencyFee).toBe(2025); // BUG: should not be urgent for expired deadlines
  });

  it('no deadline → not urgent', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 1, openedAt: OPENED_2021 }, REF);
    expect(result.urgencyFee).toBe(0);
  });

  it('deadline same day as reference → urgent', () => {
    const result = calculateFee(
      { type: 'STANDARD', complexity: 1, openedAt: OPENED_2021, deadline: '2023-06-15' },
      REF,
    );
    expect(result.urgencyFee).toBe(2025);
  });
});
```

For expedited:

```typescript
describe('expedited fee', () => {
  it('expedited=true → expedited fee applied (on bandFee + urgencyFee)', () => {
    const result = calculateFee(
      { type: 'STANDARD', complexity: 1, openedAt: OPENED_2021, deadline: '2023-06-22', expedited: true },
      REF,
    );
    expect(result.urgencyFee).toBe(2025);
    expect(result.expeditedFee).toBe(1863); // round((13500 + 2025) * 12 / 100)
    expect(result.total).toBe(13500 + 2025 + 1863);
  });

  it('expedited=false → no expedited fee', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 1, openedAt: OPENED_2021 }, REF);
    expect(result.expeditedFee).toBe(0);
  });
});
```

For rounding:

```typescript
describe('rounding at each step', () => {
  it('urgency fee is rounded at the step (Math.round)', () => {
    // STANDARD band 1, 2021: bandFee=13500, urgency 15%
    // 13500 * 15 / 100 = 2025 (exact, but rounding behavior is pinned)
    const result = calculateFee(
      { type: 'STANDARD', complexity: 1, openedAt: OPENED_2021, deadline: '2023-06-22' },
      REF,
    );
    expect(result.urgencyFee).toBe(2025);
    expect(Number.isInteger(result.urgencyFee)).toBe(true);
  });

  it('expedited fee is rounded at the step (Math.round) and computed on bandFee + rounded urgencyFee', () => {
    const result = calculateFee(
      { type: 'STANDARD', complexity: 1, openedAt: OPENED_2021, deadline: '2023-06-22', expedited: true },
      REF,
    );
    // Step 1: urgencyFee = round(13500 * 15 / 100) = 2025
    // Step 2: expeditedFee = round((13500 + 2025) * 12 / 100) = round(15525 * 12 / 100) = round(1863) = 1863
    expect(result.expeditedFee).toBe(1863);
    expect(Number.isInteger(result.expeditedFee)).toBe(true);
  });

  it('total = bandFee + urgencyFee + expeditedFee (sum of separately-rounded components)', () => {
    const result = calculateFee(
      { type: 'STANDARD', complexity: 1, openedAt: OPENED_2021, deadline: '2023-06-22', expedited: true },
      REF,
    );
    expect(result.total).toBe(13500 + 2025 + 1863);
    expect(result.total).toBe(17388);
  });
});
```

For band 3 on 2022 table where rounding actually matters (non-integer expedited fee):

Let me check: COMMERCIAL band 4, RATE_TABLE_2022:
- bandFee = 80500
- urgency (18%) = round(80500 * 18 / 100) = round(14490) = 14490
- expedited (12% of (80500 + 14490) = 94990): round(94990 * 12 / 100) = round(11398.8) = 11399

So this is a case where the expedited fee involves non-integer arithmetic before rounding. Let me use this for a test.

Actually, let me find a simpler case. APPEAL band 3, 2022:
- bandFee = 72500
- urgency (18%) = round(72500 * 18 / 100) = round(13050) = 13050
- expedited (12% of (72500 + 13050) = 85550): round(85550 * 12 / 100) = round(10266) = 10266

Hmm, that's exact too. Let me try more...

APPEAL band 4, 2022:
- bandFee = 109000
- urgency (18%) = round(109000 * 0.18) = round(19620) = 19620
- expedited (12% of 128620) = round(15434.4) = 15434

So expedited = 15434 (non-integer before rounding). Total = 109000 + 19620 + 15434 = 144054.

Great, this is a good test case. Let me use it.

For the urgency with a non-integer result: is there one? Let me check...

Actually, all the base fees are multiples of 500. 15% of 500 = 75, 18% of 500 = 90. Both are integers. So urgency is always an integer for the current data. Hmm.

Let me check: is there ANY base fee that's not a multiple of 500? Looking at the tables... no, they're all multiples of 500. So urgency fee (15% or 18% of a multiple of 500) is always an integer.

But expedited fee (10% or 12% of the sum) might not be, as shown above.

So I'll test urgency rounding with a case where it's exact, and document that the current data always produces exact urgency values but rounding is still applied (via Math.round).

For a "rounding matters" test, let me use the APPEAL band 4, 2022 case for expedited where it produces 15434 (not 15434.4).

OK let me finalize. For the full matrix with expedited, I'll test a few combinations. But actually, the task says "every case type × complexity band" — the base matrix. I'll test the base matrix (no urgency, no expedited) for all combinations across all tables. Then I'll add targeted tests for urgency, expedited, and rounding.

For the "degenerate inputs" section:

```typescript
describe('degenerate inputs', () => {
  it('complexity = 0 → clamped to band 1', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 0, openedAt: OPENED_2021 }, REF);
    expect(result.bandFee).toBe(BASE_FEES_2021.STANDARD[0]); // 13500
    expect(result.total).toBe(13500);
  });

  it('complexity = -3 → clamped to band 1', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: -3, openedAt: OPENED_2021 }, REF);
    expect(result.bandFee).toBe(BASE_FEES_2021.STANDARD[0]); // 13500
  });

  it('complexity = 5 → clamped to band 4', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 5, openedAt: OPENED_2021 }, REF);
    expect(result.bandFee).toBe(BASE_FEES_2021.STANDARD[3]); // 44500
  });

  it('complexity = null → throws "complexity is required"', () => {
    expect(() => calculateFee({ type: 'STANDARD', complexity: null, openedAt: OPENED_2021 }, REF)).toThrow(
      'complexity is required',
    );
  });

  it('complexity = undefined → throws "complexity is required"', () => {
    expect(() => calculateFee({ type: 'STANDARD', complexity: undefined, openedAt: OPENED_2021 }, REF)).toThrow(
      'complexity is required',
    );
  });

  it('unknown case type → falls back to STANDARD base fees', () => {
    const result = calculateFee({ type: 'IMPORTED' as any, complexity: 2, openedAt: OPENED_2021 }, REF);
    expect(result.bandFee).toBe(BASE_FEES_2021.STANDARD[1]); // 20500 (STANDARD band 2)
  });
});
```

For the pinned quirks and bugs:

```typescript
describe('pinned quirks and bugs', () => {
  it('PINNED BUG: past deadlines always trigger urgency fee (daysBetween <= 7 is true for negative values)', () => {
    const result = calculateFee(
      { type: 'STANDARD', complexity: 1, openedAt: OPENED_2021, deadline: '2023-03-07' }, // 100 days in past
      REF,
    );
    // BUG: urgency fee is charged even though the deadline expired 100 days ago
    expect(result.urgencyFee).toBe(2025);
    expect(result.total).toBe(13500 + 2025);
  });

  it('PINNED BUG: non-integer complexity produces NaN bandFee', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 1.5, openedAt: OPENED_2021 }, REF);
    expect(result.bandFee).toBeNaN();
    expect(result.total).toBeNaN();
  });

  it('PINNED QUIRK: REVISION_2022 boundary is exclusive — 2022-07-01 uses 2021 rates', () => {
    const result = calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, REF);
    expect(result.table).toBe('2021'); // Intuitively one might expect '2022'
  });
});
```

Wait, for the 100-days-past deadline test, I'm using REF = '2023-06-15' and deadline = '2023-03-07'. Let me verify: daysBetween('2023-06-15', '2023-03-07') = (March 7 - June 15) = about -100 days. -100 <= 7 → true → urgency. ✓

For the non-integer complexity test: complexity = 1.5. band = 1.5. bands[0.5] = undefined. bandFee = undefined. Is undefined NaN? No, it's undefined. But then total = undefined + 0 + 0 = NaN. Hmm.

Let me check what `expect(result.bandFee).toBeNaN()` does when `bandFee` is `undefined`. `toBeNaN()` checks `Number.isNaN(value)`. `Number.isNaN(undefined)` is `false`. So this assertion would fail!

Let me fix: `expect(Number.isNaN(result.bandFee)).toBe(true)` — but `Number.isNaN(undefined)` is `false`. So even this would fail.

Actually, what does the code produce? Let me trace:
- `band = 1.5`
- `bands = table.base['STANDARD']` = [13500, 20500, 29500, 44500]
- `bandFee = bands[1.5 - 1]` = `bands[0.5]` = `undefined`
- `total = undefined + 0 + 0` = `NaN` (because any arithmetic with undefined gives NaN in JS)

So `bandFee` is `undefined` and `total` is `NaN`.

For the assertion, I should check:
- `expect(result.bandFee).toBeUndefined()` — to show it's undefined
- `expect(result.total).toBeNaN()` — to show total is NaN

Or better:
- `expect(result.bandFee).toBeUndefined()`
- `expect(Number.isNaN(result.total)).toBe(true)`

Let me update the test name and assertions to be accurate.

Actually, let me verify: `undefined + 0` in JavaScript:
- `undefined + 0` = `NaN` (because undefined is coerced to NaN in arithmetic)
- `NaN + 0` = `NaN`
- `NaN + NaN` = `NaN`

So yes, `total` would be `NaN`.

Let me fix the test:

```typescript
it('PINNED BUG: non-integer complexity produces undefined bandFee and NaN total', () => {
  const result = calculateFee({ type: 'STANDARD', complexity: 1.5, openedAt: OPENED_2021 }, REF);
  expect(result.bandFee).toBeUndefined(); // bands[0.5] does not exist
  expect(Number.isNaN(result.total)).toBe(true);
});
```

Good. Now let me also add a test for the "complexity = NaN" case:
```typescript
it('complexity = NaN → clamped to band 1 (NaN is falsy via !band)', () => {
  const result = calculateFee({ type: 'STANDARD', complexity: NaN as any, openedAt: OPENED_2021 }, REF);
  expect(result.bandFee).toBe(BASE_FEES_2021.STANDARD[0]); // 13500
});
```

Wait, `!NaN` is `true`, so band would be set to 1. And `bands[0]` is 13500. So this works. But should I include this? The task mentions "zero, negative" as degenerate inputs. NaN is a float edge case that's interesting. Let me include it.

Also, I should add a test for `complexity = ''` (empty string)? No, the type is `number | null`, so it should be a number or null. TypeScript would catch this. But at runtime, if upstream doesn't validate, it could be anything. Let me not go there since it's not specified.

Let me also think about the `openedAt` edge cases more. What if `openedAt` is exactly at a boundary? I have tests for that.

What about `openedAt` in the far past or far future?
- Far past: '2015-01-01' → before REVISION_2021 → 2019 table ✓
- Far future: '2030-01-01' → after REVISION_2022 → 2022 table ✓

I could add these as well. Let me add a couple.

Also, I should think about whether the test suite needs any setup. Looking at the task conventions, vitest is used. The test file should work out of the box with a basic vitest config.

Now let me finalize the FINDINGS.md:

```markdown
# FINDINGS.md — feeCalculator.ts Characterization

## F-01: Past deadlines always trigger urgency fee [BUG]

**Reproducing input:** `{ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: '2023-
```

## reply

(empty)
