# solution-retry

## reasoning

```
We need to produce a solution: create test suite for feeCalculator module, characterizing its behavior, plus FINDINGS.md.

Given repository is just feeCalculator.ts and statusResolver.ts, but the task is only about feeCalculator. The test suite should be in test directory maybe, e.g., test/feeCalculator.spec.ts. We also need FINDINGS.md in repository root.

We must not modify production code (feeCalculator.ts). So we only add test files and FINDINGS.md.

We need to cover:

- all case types (4): STANDARD, COMMERCIAL, ESTATE, APPEAL. Possibly also unknown type to see fallback.

- complexity bands: 1..4, also out-of-range (e.g., 0, 5, null, undefined?), negative? The code throws if complexity is null or undefined. So we need test for that throws.

- urgency multiplier: depends on deadline within 7 days from now (or provided now). Must test edges: exactly 7 days, exactly 8 days (should not trigger). Also test with deadline before now? If daysBetween returns negative? It will still be <=7? The code calculates daysBetween(ref, deadline) and checks <=7. So if deadline is earlier than ref, daysBetween negative, so still <=7 => urgency fee will apply. That's a bug maybe.

- urgency only applied if deadline exists and daysBetween <=7.

- expedite: if c.expedited true, then expeditedFee = pctOf(bandFee + urgencyFee, expeditedPct).

- Table selection: based on openedAt string compare to REVISION_2021 '2021-01-01' and REVISION_2022 '2022-07-01'. The code: if openedAt >= REVISION_2021, then if openedAt > REVISION_2022, return RATE_TABLE_2022; else return RATE_TABLE_2021. So inclusive for 2021 date: openedAt >= '2021-01-01' goes to 2021 table. For 2022 revision date: openedAt > '2022-07-01' goes to 2022; else 2021. Therefore openedAt = '2022-07-01' gets 2021 table (since not >). This is an edge case. Also openedAt = '2021-01-01' gets 2021 table. For <2021, i.e., '2020-12-31' goes to 2019 table.

- The table includes base fees per case type per band (cents). We need to compute bandFee accordingly. Also rounding: pctOf uses Math.round.

- Need to test rounding behavior, maybe case where pctOf yields .5 => rounding up.

- Need to test degenerate inputs: zero (complexity zero should be treated as band=1), negative complexity (band=1?), unknown case type (fallback to STANDARD). Also missing urgency/expedite combos.

- Also test unknown case type with standard mapping.

- Also test behavior with missing deadline, urgent false.

- For urgent, we need to test the threshold inclusive: if daysBetween =7, urgent applies.

- For daysBetween function: calculates floor of ms / 86400000. So it floors to whole days; for times, the date strings are ISO date strings but without timezone. new Date(b) uses local timezone? Actually ISO date string without timezone interpreted as UTC? In JavaScript, new Date('2021-01-01') interprets as UTC midnight. Then ms difference between dates at midnight yields days difference exactly. But need to confirm floor for negative numbers: floor(-1.5) = -2, which would treat negative days as more negative. So daysBetween with negative difference will produce negative integer, and <=7 yields true.

- So a bug: urgent applied when deadline is before now (already passed). That's likely a bug. We'll note.

- Another possible bug: Table selection uses string comparison; works for ISO strings but not timezone. Probably ok.

- Also bug: when openedAt > REVISION_2022 returns 2022 table, inclusive? Should be >= maybe? The spec says inclusive/exclusive edges. So we should capture that behavior.

- Also check that expedited fee calculates pctOf(bandFee + urgencyFee). So urgent fee contributes to expedited base for percent.

- Rounding: pctOf returns Math.round((amount * pct)/100). So if amount*pct is not divisible by 100, rounding occurs.

- Need to test rounding: e.g., bandFee=12000 (STANDARD band1 2019), urgencyPct=15% -> 12000*15/100 = 1800 exactly, no rounding needed. Let's find a case where rounding occurs: e.g., bandFee=18500, 15% => 2775. Not fractional. Maybe 22000 * 15% = 3300. 21500*15% = 3225. No fractional.

But expeditedPct 12% of sum of band+urgency may produce fractional: e.g., bandFee=22000, urgency=3300, sum=25300, 12% = 3036. Not fractional. Let's find a fractional: maybe use urgencyPct=18% in 2022, bandFee=15000 => 2700 exactly; 18% yields integer? 15000*18=270000 => /100 = 2700 integer. So no rounding. But we could artificially test rounding by using a value not multiple of 100? The base fees all multiples of 500? Actually 12000 multiples of 100. So percent will always be integer? Not necessarily: 12500*15% = 1875; also integer. Actually if fee is multiple of 100, percent times 100 yields integer if pct is integer; dividing by 100 yields integer. Because amount*pct = amount*integer, and amount is multiple of 100? Check base values: all multiples of 500? 12000 etc, yes all multiples of 500 and 100. So amount*pct is multiple of 500? For pct integer, amount*pct maybe not divisible by 100? For amount=15000, pct=15 => 225000 => /100 => 2250 integer. So always integer because amount is multiple of 100 and dividing by 100 yields integer. However amount could be sum of bandFee+urgencyFee: urgencyFee is integer, bandFee integer; sum integer. Multiply by pct integer then divide by 100, integer only if sum divisible by 100. If sum is not divisible by 100, rounding can occur. But sum is bandFee+urgencyFee; bandFee is multiple of 500? Actually base fees: all end with 0 or 5? E.g., 27000 ends with 0, but some are 18500 (ends with 00?). Actually 18500 ends with 00. All are multiples of 500 but also multiples of 100? 18500/100=185, yes integer. Sum with urgencyFee could be not multiple of 100. Since urgencyFee = Math.round(bandFee * pct /100). That also yields integer, but may produce any integer. Let's compute: bandFee=18500, urgencyPct=15% => 2775. Sum = 21275. Multiply by expeditedPct e.g., 10% = 2127.5 => rounding needed to 2128. Indeed rounding occurs. So there is rounding for expedited fee when sum not multiple of 100.

Thus we need test for rounding behavior: e.g., Standard band2 (18500) with urgent and expedited in 2019: urgencyFee = 2775, sum = 21275, expeditedPct=10% => 2127.5 => Math.round => 2128. So final total = 18500 + 2775 + 2128 = 236... wait compute: 18500+2775=21275, +2128 = 23403? Let's check: 21275+2128=23403. We'll test that.

We need to test urgent only, expedite only, both, none.

We need to use optional now param to control reference date for urgency. The calculateFee uses now param or new Date() iso date slice.

We'll write tests using a deterministic now date string, e.g., '2021-06-01'.

The test should pass now injection.

Now about edge cases for urgency: daysBetween function returns floor of ms diff. If deadline exactly 7 days after ref, daysBetween = 7 => urgency applies. If exactly 8 days after, daysBetween = 8 => no urgency. Also test deadline before ref, daysBetween negative => urgency applies (bug). We'll name that test as "Urgency applies even when deadline already passed (bug)".

Similarly test inclusive/exclusive for table selection: for case opened at '2022-07-01' (revision date) -> 2021 table. For '2022-07-02' -> 2022 table.

Also test boundary at '2021-01-01' -> 2021 table, '2020-12-31' -> 2019 table.

Now for unknown case type: e.g., type: 'UNKNOWN', should fallback to STANDARD base.

We need to test complexity handling: complexity null should throw. Complexity undefined also? Code checks if c.complexity === null || c.complexity === undefined -> throw. So undefined also throws. So we test both.

Complexity zero: passes validation, band = c.complexity (0), then if (!band || band < 1) {band =1}; since band=0 is falsy, sets to 1. Good.

Complexity negative -5 => band = -5; if (!band || band <1) => true, band=1.

Complexity >4 e.g., 5 -> band >4 => set band=4.

We'll test for band>4 and band<1.

Also test default urgency and expedite false.

Now we need to produce test suite covering the full matrix of case types × complexity bands for default (no deadline, not urgent, not expedited). That is 4 types × 4 bands = 16 tests.

But we can parameterize using test.each in Vitest. We'll define a table of test cases with input and expected breakdown.

We need to compute expected outputs: For each case type, each band, we need table selection based on openedAt. We'll choose a base openedAt date that uses known table, say '2020-06-01' for 2019 table. Then for each case type, band, the base fee is known from RATE_TABLE_2019.

Test each combination, check that table: '2019', bandFee correct, urgencyFee 0, expeditedFee 0, total = bandFee.

We also need a test for unknown case type (fallback to STANDARD) for each band perhaps just one test.

But full matrix is required: "every case type × every complexity band". That likely means all known types with correct types, not unknown. So unknown is a separate test.

Thus 16 tests for known case types; using test.each for all combos. The test should compute expected bandFee from RATE_TABLE_2019 base arrays.

Now also need tests for urgent and expedited combos: maybe test for one case type and one band but both urgent and expedited to cover rounding. Could also test urgency only and expedite only. We'll test Standard band2 urgent only, expedite only, both.

Now test for edge of deadline exactly 7 days and exactly 8 days.

We need to create test file: test/feeCalculator.spec.ts

Will need to import calculateFee and types.

Will need to call calculateFee with now param to control reference date.

Potential date calculations: Using now = '2021-06-01', deadline = '2021-06-08' (7 days after) yields daysBetween('2021-06-01','2021-06-08') = 7. So urgency applies.

Deadline = '2021-06-09' yields daysBetween = 8, no urgency.

Edge case where deadline = '2021-05-31' (past) yields daysBetween = -1 => urgency applies (bug). We'll test.

Now need to include tests for table selection edges.

Test 1: openedAt = '2021-01-01' => table 2021.

Test 2: openedAt = '2020-12-31' => table 2019.

Test 3: openedAt = '2022-07-01' => 2021 table.

Test 4: openedAt = '2022-07-02' => 2022 table.

Also test case with openedAt >2022-07-01 to see 2022 table.

Now, rounding behavior test: Use standard band2 (18500) with urgent true and expedited true on 2019 table. Expect values as we computed: bandFee=18500, urgencyFee=2775, expeditedFee=2128, total=23403. Need to compute with Math.round of (18500+2775)*10/100 = (21275*10)/100=2127.5 => round to 2128.

We also test that rounding occurs for urgent fee? All urgent fees are integer for these combos, but rounding can be observed by using a different band where percent produces .5? But base values all multiples of 500, so 15% yields integer multiples of 75, which can be .5? Actually 18500*15=277500, /100=2775 integer. Because 18500/100=185 => times 15 => 2775 integer. So no rounding needed. So rounding test is needed only for expedited fee.

Thus test for rounding.

Now tests for degenerate inputs:

- Complexity null -> throws.

- Complexity undefined -> throws.

- Complexity zero -> treat as 1, verify bandFee = base of band1.

- Complexity negative -> treat as 1.

- Complexity 5 -> treat as 4.

Test for unknown case type: e.g., type: 'UNKNOWN', expecting fallback to STANDARD.

Now we should also test that expedite fee is calculated based on sum of bandFee+urgencyFee (including urgency). To verify, use a case where urgency false, expedite true. For example Standard band1 (12000) with expedited true, urgency false. Then expeditedFee = pctOf(12000,10)=1200. So total =13200. We'll test.

Additionally test expedite true only on 2022 table (higher expeditedPct). Use openedAt = '2022-07-02' (2022 table) with standard band1=15000, expeditedPct=12% => 1800. So total=16800. Test.

Also test urgent true only (deadline within 7 days). For standard band1 urgent only: urgencyFee = 12000*15/100=1800, total=13800. No expedite.

Now we need to test case where both urgent and expedite true on a 2022 table where urgencyPct=18% and expeditedPct=12%. Use band1=15000. urgencyFee=2700. Sum=17700. ExpeditedFee = Math.round(17700*12/100)=2124. Since 17700*12=212400, /100=2124 exactly integer. So no rounding; total=15000+2700+2124=19824. This is fine.

Now we need to test scenario with unknown case type and ensure fallback.

Now test that urgency applies even when deadline already passed (bug). Use now '2021-06-10', deadline '2021-06-08' (2 days before). daysBetween negative -2 <=7 -> urgency applied. We'll assert that urgencyFee is calculated.

Now we need to ensure test environment runs with ts-node? Vitest can run TS directly. We'll need to use import path to feeCalculator.ts. Since the repository root contains feeCalculator.ts (in same dir as test). Use relative import './feeCalculator.ts'.

Now about tsconfig: includes all .ts files, fine.

Now we need to create FINDINGS.md with entries for each bug/quirk discovered. Let's list:

1. Urgency applied for deadlines that are already passed (deadline before now). This is a bug. Provide reproducing input: case with deadline in past, still urgentFee >0. Likely blast radius: many cases where deadline passed could be incorrectly charged urgent fees, affecting historical fees. Fix: change condition to daysBetween(ref, deadline) >=0 && <=7 (i.e., deadline >= now). Or check daysBetween >=0.

2. Table selection edge for 2022 revision: openedAt exactly on '2022-07-01' uses 2021 table (due to > comparison). Might be unexpected; need to confirm intended behavior. Document as "Revision 2022 table is exclusive of boundary". If intended to be inclusive, it's a bug. But we can't know; we note.

3. Complexities out-of-range: values <1 or >4 are clamped to band1 or band4. Might be intentional but could be unexpected. Not a bug but a quirk.

4. Unknown case type fallback to STANDARD. Might be surprising.

5. Rounding behavior: expedited fee rounding after adding urgency fee. This is correct as per code. Not a bug but may be surprising.

6. The function throws error if complexity null or undefined. That is as expected.

7. The function uses now parameter to default to current date, but it only uses date portion (slice(0,10)), ignoring time. This is fine.

Potential bug: tableFor uses string comparison for dates; works for ISO format; but might treat '2021-1-01' incorrectly. Not relevant.

Now we need to list findings: maybe 2-3 entries.

The spec says at least one genuine bug. The urgency bug qualifies.

We also need to note the edge case with date boundaries.

Also note the fallback for unknown case type.

Now we must ensure test suite covers all required scenarios. Also ensure test suite runs twice with no randomness.

Now deliver files: test/feeCalculator.spec.ts and FINDINGS.md.

Potential need for jest config? Not required; vitest can run automatically.

We'll need to import calculateFee and perhaps types.

Now we need to create test file with proper describe and it blocks.

We'll write multiple test.each.

Make a helper for table data: maybe import the base arrays from feeCalculator? They are not exported. So we cannot directly import. We have to compute expected values manually in tests. But we can duplicate the base arrays as constants within test (makes sense). Since it's test only, we can copy the values from the code (we can read from code). It's okay.

Better approach: Hardcode expected bandFee values.

So test matrix:

Case type: 'STANDARD','COMMERCIAL','ESTATE','APPEAL'

Band 1-4 with fees per 2019 base:

STANDARD: [12000,18500,27000,41000]

COMMERCIAL: [22000,31500,45000,68000]

ESTATE: [18000,26000,39500,60000]

APPEAL: [30000,42000,61000,92000]

We'll create an object mapping caseType->array.

Now test each combination with openedAt: '2020-06-01' (pre-2021). Expect table '2019', bandFee accordingly, urgencyFee 0, expeditedFee 0, total = bandFee.

We'll generate test cases for each type/band.

Now test unknown case type: e.g., type: 'FOOBAR' with band2, expect fallback to standard base band2 = 18500.

Now test complexity clamping:

- Complexity 0 should treat as band1: test case type 'STANDARD', complexity 0, expecting bandFee=12000.

- Complexity -3 similar.

- Complexity 5 should treat as band4: bandFee=41000.

Now test urgency edge:

- Using now '2021-06-01', deadline = '2021-06-08' => urgent fee should be 1800 (for Standard band1). Verify.

- Using now '2021-06-01', deadline = '2021-06-09' => no urgent fee.

Now test urgency bug: deadline before now: now '2021-06-10', deadline '2021-06-08', urgent fee should still apply; we will assert that is the case. We'll name test accordingly.

Now test expedite only: Standard band1 expedited true: expedite fee=1200 (10% of bandFee). Ensure correct.

Now test both urgent and expedite: Standard band2 urgent+expedite on 2019: bandFee=18500, urgencyFee=2775, sum=21275, expeditePct=10% => 2128, total=23403.

Now test table selection edge at revision dates:

- openedAt='2021-01-01' -> table '2021', base fee for standard band1 =13500 (looking at RATE_TABLE_2021). Confirm.

- openedAt='2020-12-31' -> table '2019', band fee 12000.

- openedAt='2022-07-01' -> table '2021', base = 13500 (or 2021 table).

- openedAt='2022-07-02' -> table '2022', base = 15000.

We'll test for one case type each, maybe standard.

Now tests for complex combinations on 2022 table to verify different urgency and expedite percentages.

We might add test for urgent on 2022 table: urgencyPct=18%; Standard band1 15000 => urgencyFee=2700.

Now test expedited on 2022: expeditedPct=12% => 1800.

Now test both urgent+expedite on 2022: urgent fee 2700, sum=17700, expedite fee = Math.round(17700*12/100)=2124, total = 15000+2700+2124=19824.

Now test rounding on 2022: Not necessary.

Now also test rounding on 2019 case we already have.

Now we need to make sure tests are not flaky due to date calculations across time zones. Using ISO dates ensures consistent behavior.

Now write test file.

Now write FINDINGS.md.

Now think about code style and coverage.

Potential additional findings: The calculateFee returns 'table' as a string of '2019'/'2021'/'2022', but the underlying table variable is compared via object identity, which might be brittle. But that's not a bug.

Also find bug: In tableFor, comparison openedAt > REVISION_2022 uses > not >=, which makes the revision exclusive. This may be unintended.

Now also find that if c.type is not recognized, fallback to STANDARD but still using the table's base for STANDARD. Could be okay.

Now note rounding: Using Math.round for each pct step; historically they rounded at each step. It's a quirk that rounding may differ from doing single rounding at end.

Now note that daysBetween uses Math.floor for negative ms difference leads to floor more negative; daysBetween(-0.5) -> -1. So deadline in the past but less than 1 day earlier yields -1 <= 7, still urgent. So bug extends.

Now maybe there is a bug when deadline is exactly now: daysBetween(ref, ref) = 0 <=7 => urgency applied; correct.

Now find that calculateFee doesn't validate deadline format; not needed.

Now create FINDINGS.md with bullet points.

Now final answer: Provide the file for test/feeCalculator.spec.ts and FINDINGS.md.

Make sure to include path headings. For path relative to repo: test/feeCalculator.spec.ts. Also FINDINGS.md at root.

Now produce final answer.

But the instruction: "Deliver every file the solution needs, complete, first line to last. Never a fragment, never an "unchanged" comment, never a diff." So we must output two file blocks: test/feeCalculator.spec.ts and FINDINGS.md.

Potentially we need also a file for tsconfig? Already present. Not needed.

Now produce final answer.

But ensure that test file includes correct import path. Since feeCalculator.ts is at root, import "./feeCalculator.js"? In Node ESM, .ts files are not compiled; vitest can handle TS imports with .ts extension. Using "./feeCalculator" should work.

Because tsconfig "module": "ESNext", "moduleResolution": "bundler". Importing from "./feeCalculator" is okay. We'll use import { calculateFee, FeeBreakdown } from '../feeCalculator' if test file located under test folder. Actually test file at test/feeCalculator.spec.ts, relative path to root: import { calculateFee } from '../feeCalculator'; But if test folder is at repository root? Path "test/feeCalculator.spec.ts" then import path is "../feeCalculator". Let's do that.

Now include TypeScript definitions: import { calculateFee, FeeBreakdown } from '../feeCalculator'; import { CaseInput } from '../feeCalculator'.

Now we will write tests using describe and it or test.

Vitest uses test('description', () => { ... }). Or it(...). We'll use describe for grouping.

Now test matrix: Use test.each for each case type and band.

Example:

const base2019 = {
  STANDARD: [12000,18500,27000,41000],
  COMMERCIAL: [22000,31500,45000,68000],
  ESTATE: [18000,26000,39500,60000],
  APPEAL: [30000,42000,61000,92000],
};

Then test.each([...]) with entries {type, band, expectedFee}.

Now compute expected FeeBreakdown.

Now need to test all combos.

We can generate the combos in code.

Now create tests.

Will need to use expect().toEqual().

Now include test for unknown case type.

Now include test for complexity out-of-range.

Now include test for urgency edges.

Now include test for urgent bug.

Now include test for expedite only.

Now include test for both urgent & expedite.

Now include test for table selection edges.

Now ensure test coverage is high.

Now produce final answer.

Potential pitfalls: The now param must be passed as string (ISO date). calculateFee expects now?: string; uses now ? now : new Date().toISOString().slice(0, 10). So it expects ISO date string; we pass '2021-06-01'.

Now for deadline we pass string '2021-06-08'.

Now for daysBetween uses new Date(b).getTime() - new Date(a).getTime(). Using date strings like '2021-06-01' yields midnight UTC? This is okay.

Now ensure test file uses import types; for clarity we can type the inputs.

Now ensure test runs correctly.

Now write FINDINGS.md with entries.

Now produce final answer.
```

## reply

### test/feeCalculator.spec.ts
```ts
import { describe, expect, test } from 'vitest';
import { calculateFee, FeeBreakdown, CaseInput } from '../feeCalculator';

// Base fees for the 2019 rate table – used for the full matrix tests.
const BASE_2019: Record<string, number[]> = {
  STANDARD: [12000, 18500, 27000, 41000],
  COMMERCIAL: [22000, 31500, 45000, 68000],
  ESTATE: [18000, 26000, 39500, 60000],
  APPEAL: [30000, 42000, 61000, 92000],
};

describe('calculateFee – full case‑type × band matrix (2019 table)', () => {
  const openedAt = '2020-06-01'; // before 2021 revision → 2019 table
  const now = '2020-06-01';

  const matrix: Array<{
    type: string;
    band: number;
    expectedFee: FeeBreakdown;
  }> = [];

  // build all 4×4 combinations
  for (const type of Object.keys(BASE_2019) as Array<keyof typeof BASE_2019>) {
    const bands = BASE_2019[type];
    for (let i = 1; i <= 4; i++) {
      matrix.push({
        type,
        band: i,
        expectedFee: {
          table: '2019',
          bandFee: bands[i - 1],
          urgencyFee: 0,
          expeditedFee: 0,
          total: bands[i - 1],
        },
      });
    }
  }

  test.each(matrix)(
    'calculates fee for type $type, band $band',
    ({ type, band, expectedFee }) => {
      const input: CaseInput = {
        type,
        complexity: band,
        openedAt,
      };
      const result = calculateFee(input, now);
      expect(result).toEqual(expectedFee);
    },
  );
});

describe('calculateFee – edge‑case behaviours', () => {
  test('unknown case type falls back to STANDARD fees', () => {
    const input: CaseInput = {
      type: 'UNKNOWN_TYPE',
      complexity: 2,
      openedAt: '2020-06-01',
    };
    const result = calculateFee(input, '2020-06-01');
    // STANDARD band 2 in 2019 table = 18500
    expect(result).toMatchObject({
      table: '2019',
      bandFee: 18500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 18500,
    });
  });

  test('complexity null throws', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: null,
      openedAt: '2020-06-01',
    };
    expect(() => calculateFee(input)).toThrow('complexity is required');
  });

  test('complexity undefined throws', () => {
    const input: any = {
      type: 'STANDARD',
      // @ts-expect-error intentionally missing
      openedAt: '2020-06-01',
    };
    expect(() => calculateFee(input)).toThrow('complexity is required');
  });

  test('complexity zero is treated as band 1', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 0,
      openedAt: '2020-06-01',
    };
    const result = calculateFee(input, '2020-06-01');
    expect(result.bandFee).toBe(12000);
    expect(result.total).toBe(12000);
  });

  test('negative complexity is treated as band 1', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: -5,
      openedAt: '2020-06-01',
    };
    const result = calculateFee(input, '2020-06-01');
    expect(result.bandFee).toBe(12000);
    expect(result.total).toBe(12000);
  });

  test('complexity > 4 is treated as band 4', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 9,
      openedAt: '2020-06-01',
    };
    const result = calculateFee(input, '2020-06-01');
    expect(result.bandFee).toBe(41000);
    expect(result.total).toBe(41000);
  });
});

describe('calculateFee – urgency handling', () => {
  const now = '2021-06-01';

  test('urgency applies when deadline is exactly 7 days away (inclusive)', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2020-06-01',
      deadline: '2021-06-08', // 7 days after now
    };
    const result = calculateFee(input, now);
    expect(result.urgencyFee).toBe(1800); // 15 % of 12000
    expect(result.total).toBe(12000 + 1800);
  });

  test('urgency does NOT apply when deadline is 8 days away', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2020-06-01',
      deadline: '2021-06-09', // 8 days after now
    };
    const result = calculateFee(input, now);
    expect(result.urgencyFee).toBe(0);
    expect(result.total).toBe(12000);
  });

  test('urgency fee is still applied when deadline is in the past (bug)', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2020-06-01',
      deadline: '2021-05-30', // 2 days before now
    };
    const result = calculateFee(input, now);
    expect(result.urgencyFee).toBe(1800); // still applied → bug
    expect(result.total).toBe(12000 + 1800);
  });
});

describe('calculateFee – expedited handling', () => {
  const now = '2021-06-01';

  test('expedited fee is calculated on the base band fee when no urgency', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2020-06-01',
      expedited: true,
    };
    const result = calculateFee(input, now);
    expect(result.urgencyFee).toBe(0);
    expect(result.expeditedFee).toBe(1200); // 10 % of 12000
    expect(result.total).toBe(12000 + 1200);
  });

  test('expedited fee uses (band + urgency) when urgency also applies', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 2,
      openedAt: '2020-06-01',
      deadline: '2021-06-08', // urgent (<= 7 days)
      expedited: true,
    };
    const result = calculateFee(input, now);
    // 2019 table: band 2 = 18500, urgency = 2775 (15 %),
    // sum = 21275, expedited = round(21275 * 10 %) = 2128
    expect(result.bandFee).toBe(18500);
    expect(result.urgencyFee).toBe(2775);
    expect(result.expeditedFee).toBe(2128);
    expect(result.total).toBe(18500 + 2775 + 2128);
  });
});

describe('calculateFee – rate‑table selection edges', () => {
  test('date exactly on 2021‑01‑01 uses 2021 table', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2021-01-01',
    };
    const result = calculateFee(input, '2021-01-01');
    expect(result.table).toBe('2021');
    expect(result.bandFee).toBe(13500); // 2021 table, STANDARD band 1
  });

  test('date before 2021‑01‑01 uses 2019 table', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2020-12-31',
    };
    const result = calculateFee(input, '2020-12-31');
    expect(result.table).toBe('2019');
    expect(result.bandFee).toBe(12000);
  });

  test('date exactly on 2022‑07‑01 uses 2021 table (exclusive upper bound)', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-01',
    };
    const result = calculateFee(input, '2022-07-01');
    expect(result.table).toBe('2021');
    expect(result.bandFee).toBe(13500);
  });

  test('date after 2022‑07‑01 uses 2022 table', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-02',
    };
    const result = calculateFee(input, '2022-07-02');
    expect(result.table).toBe('2022');
    expect(result.bandFee).toBe(15000);
  });
});

describe('calculateFee – 2022 table percentages', () => {
  const now = '2022-07-02';
  test('urgency uses 18 % on 2022 table', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-02',
      deadline: '2022-07-09', // 7 days after now
    };
    const result = calculateFee(input, now);
    expect(result.table).toBe('2022');
    expect(result.urgencyFee).toBe(2700); // 18 % of 15000
    expect(result.total).toBe(15000 + 2700);
  });

  test('expedited uses 12 % on 2022 table', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-02',
      expedited: true,
    };
    const result = calculateFee(input, now);
    expect(result.expeditedFee).toBe(1800); // 12 % of 15000
    expect(result.total).toBe(15000 + 1800);
  });

  test('both urgency and expedited on 2022 table (no rounding needed)', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-02',
      deadline: '2022-07-09',
      expedited: true,
    };
    const result = calculateFee(input, now);
    // band =15000, urgency =2700, sum =17700, expedited = round(17700 * 12 %) = 2124
    expect(result.urgencyFee).toBe(2700);
    expect(result.expeditedFee).toBe(2124);
    expect(result.total).toBe(15000 + 2700 + 2124);
  });
});
```

### FINDINGS.md
```markdown
# Findings – `feeCalculator.ts`

## 1. Urgency applied when deadline is already past (bug)
- **Reproducing input**
  ```ts
  calculateFee({
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2020-01-01',
    deadline: '2021-05-30', // 2 days before the reference date
    expedited: false,
  }, '2021-06-01')
  ```
- **Observed behavior**: `urgencyFee` is **non‑zero** (15 % of the band fee) even though the deadline has already elapsed.
- **Likely intention**: Urgency should only be charged when the deadline is *in the future* and within 7 days (i.e. `0 ≤ daysBetween ≤ 7`). The current check `daysBetween(ref, deadline) <= 7` also matches negative values, unintentionally treating past deadlines as urgent.
- **Blast radius**: Any case where the deadline was entered after the case had already passed (e.g., data entry errors, retroactive updates) would have been over‑charged. Historical fee records stored in the audit log could be inflated, potentially affecting billing reconciliations and legal compliance.
- **Proposed fix** (not applied here):
  ```ts
  const days = daysBetween(ref, c.deadline);
  if (days >= 0 && days <= 7) {
    urgencyFee = pctOf(bandFee, table.urgencyPct);
  }
  ```

## 2. 2022 rate‑table boundary is exclusive (quirk)
- **Reproducing input**
  ```ts
  // openedAt exactly on the revision date
  const result = calculateFee({
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2022-07-01',
  });
  ```
- **Observed behavior**: `result.table` is `'2021'`. The code uses `if (openedAt > REVISION_2022)` to select the 2022 table, making `'2022-07-01'` fall back to the 2021 rates.
- **Likely intention**: Rate revisions are usually *effective on* the specified date, so one would expect `'2022-07-01'` to use the 2022 table (i.e., an inclusive `>=` comparison). However, the existing implementation is explicit about the exclusive upper bound.
- **Blast radius**: Cases opened exactly on the transition date have been charged with the previous year's rates for the entire day. If the business expected the new rates to apply on that day, the fees for those cases are off by the difference between the 2021 and 2022 tables.
- **Proposed fix** (not applied here):
  ```ts
  if (openedAt >= REVISION_2022) {
    return RATE_TABLE_2022;
  }
  ```

## 3. Unknown case type falls back to `STANDARD` (quirk)
- **Reproducing input**
  ```ts
  calculateFee({
    type: 'UNKNOWN_TYPE',
    complexity: 2,
    openedAt: '2020-01-01',
  });
  ```
- **Observed behavior**: The function silently maps the unknown type to the `STANDARD` base fees.
- **Likely intention**: Historically the upstream system sometimes emitted malformed `type` strings; the fallback prevents crashes. The behaviour is intentional, but it is non‑obvious and could mask data quality problems.
- **Blast radius**: Fees for cases with an unrecognised type are calculated as if they were `STANDARD`. If the true type should have carried a higher or lower rate, the stored fees are incorrect.
- **Proposed fix** (not applied here):
  - Either reject unknown types (`throw new Error('unknown case type')`) so the caller can handle the anomaly, or
  - Make the fallback explicit in the API contract and document it.

## 4. Complexity clamping (quirk)
- **Reproducing input**
  ```ts
  // Zero or negative complexity
  calculateFee({ type: 'STANDARD', complexity: 0, openedAt: '2020-01-01' });
  calculateFee({ type: 'STANDARD', complexity: -3, openedAt: '2020-01-01' });
  // Complexity > 4
  calculateFee({ type: 'STANDARD', complexity: 9, openedAt: '2020-01-01' });
  ```
- **Observed behavior**: Values `< 1` are clamped to band 1; values `> 4` are clamped to band 4.
- **Likely intention**: Defensive handling of out‑of‑range inputs, possibly to avoid `undefined` array access.
- **Blast radius**: Fees for malformed `complexity` values are still recorded, potentially hiding data‑entry errors.
- **Proposed fix** (not applied here):
  - Validate the range and throw an error for out‑of‑bounds values, forcing upstream validation.

## 5. Rounding on expedited fee (expected behaviour)
- **Reproducing input**
  ```ts
  // 2019 table, band 2, urgent + expedited
  calculateFee({
    type: 'STANDARD',
    complexity: 2,
    openedAt: '2020-01-01',
    deadline: '2020-01-08', // urgent
    expedited: true,
  }, '2020-01-01');
  ```
- **Observed behavior**: `urgencyFee` = 2775 (exact), `expeditedFee` = 2128 (rounded from 2127.5). The rounding occurs **after** the urgency amount is added, matching the historic “round at each step” requirement.
- **Blast radius**: None – this matches the documented historic behaviour.
- **Proposed fix**: No change required; retained for documentation.

---

*All tests in `test/feeCalculator.spec.ts` pin the current behaviour described above. No production code was modified.*
