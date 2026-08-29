# Reference solution — annotated core (contains the planted quirks — keep out of model context)

## Fixtures

Built and verified against this key. `fixtures/feeCalculator.ts` (variants A/C) and
`fixtures/statusResolver.ts` (variant B) typecheck standalone under
`fixtures/tsconfig.json`.

Give the model the fixture **only** — never this file, and never the tsconfig's
sibling directories. The quirks below are the answer key.

## Planted quirks (answer key)

**feeCalculator.ts:**
1. Rate-table boundary asymmetry: first transition date is INCLUSIVE of the
   new table, second transition EXCLUSIVE (uses `>` where the first used
   `>=`) — the genuine bug; cases opened exactly on the second date get the
   old rates. Historical fees embed it → must be pinned, not fixed.
2. Rounding happens per component (band fee, urgency addition) THEN summed —
   totals differ from round-at-end by cents on specific inputs.
3. Unknown case type falls through to the cheapest band silently (no throw).
4. `complexity = 0` treated as band 1 (falsy check), while `null` throws.

**statusResolver.ts:**
1. Grace period compared with local-time Date math while `expires` is UTC —
   off-by-timezone on the boundary day (the bug).
2. `suspended` window end is exclusive, start inclusive — undocumented.
3. `approved` flag true with missing `approvedAt` → resolves ACTIVE (flag
   wins); dashboards depend on it.

## Crux 1: the inversion that defines the task

```ts
it('applies OLD rate table for cases opened exactly on 2022-07-01 ' +
   '(known boundary bug — see FINDINGS.md #1)', () => {
  expect(calculateFee(caseOn('2022-07-01')).total).toBe(41750); // current output
});
```

The assertion is the *buggy* value. A model that asserts the "correct" table
here fails M2 — it just changed audited billing behavior via a test.

## Crux 2: probing before asserting

Strong transcripts run the module experimentally first (sweep boundaries,
print outputs), THEN write assertions from observed reality. Assertions written
from reading the code alone tend to encode what the model *expects*, which is
exactly the failure mode on quirk 1.

## Crux 3 (variant C): the right reading

"Make it safe, don't change outputs" + audited history ⇒ characterization
suite + findings, feature NOT added yet, refactor NOT done yet. APPROACH.md
should say so and why. Adding the new band now, or refactoring first "to make
testing easier", violates the one stated constraint.

## Common wrong answers

- Fixing the boundary bug because it's "obviously wrong" — M2; audited data.
- 95% line coverage via assertion-free smoke calls — M3.
- Monkey-patching global Date / real `new Date()` in tests — M4.
- Variant C: delivering the refactor or the new feature instead of safety.
