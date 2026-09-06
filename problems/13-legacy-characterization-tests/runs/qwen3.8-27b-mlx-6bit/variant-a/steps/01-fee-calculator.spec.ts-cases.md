# 01-fee-calculator.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/fee-calculator.spec.ts` based on the task statement and PLAN.md. They explicitly say "Do not write the tests" — just list them in a specific format.

Let me analyze what I need to cover:

1. Every case type × complexity band (base fee table)
2. Urgency multipliers
3. Rate-table date boundaries (inclusive/exclusive edges on both transitions)
4. Rounding at each step
5. Degenerate inputs (zero, negative, unknown case type)
6. Quirks and bugs pinned AS THEY ARE

From the PLAN.md, I can see the planned test cases. Let me also think about what the actual fixture likely contains based on the description:
- ~250 lines
- Computes procedural fees from case type, complexity band, urgency multipliers, and date-dependent rate tables
- Rates changed twice over the years; code selects table by case opening date
- Used by billing; historical outputs stored and audited

Let me list the test cases following the format:
`- <name of the test> — <what it proves, and what would have to be broken for it to fail>`

I need to be specific about what would have to break. Let me think through each:

1. Base fee for every case-type × complexity-band pair — the rate table entries themselves would need to be wrong
2. Default urgency multiplier of 1.0 — the default value in the code would need to change
3. Each documented urgency multiplier (1.5, 2.0, 3.0) — the multiplication arithmetic
4. Rate-table-1 when openedAt is strictly before transition 1 — the comparison operator or date boundary
5. Rate-table-1 when openedAt equals transition 1 (inclusive edge) — the boundary is inclusive for table 1
6. Rate-table-2 when openedAt is day after transition 1 — routing to next table
7. Rate-table-2 when openedAt is strictly before transition 2 — middle window
8. Rate-table-2 when openedAt equals transition 2 (inclusive edge) — boundary semantics
9. Rate-table-3 when openedAt is day after transition 2 — post-boundary routing
10. Rounding at final step — rounding mode (round vs floor vs ceil)
11. Rounding at intermediate steps — per-step vs final-only rounding
12. Zero urgency → 0 — degenerate case
13. QUIRK: negative urgency clamped to 1.0 — not throwing, clamping
14. QUIRK: unknown caseType falls to default rate — no validation
15. QUIRK: unknown complexity treated as "low" — no validation
16. BUG: something specific (off-by-one, wrong multiplier, etc.)
17. `now` parameter usage — future-dated cases
18. Non-trivial rounding at .5 boundary

Let me also think about what's awkward:
- The inclusive/exclusive boundary is the classic off-by-one
- Rounding at .5 is where Math.round vs Math.floor differ
- The interaction between rounding steps matters (round(2.4*1.5) vs round(2.4)*1.5)

Let me also think about what I'm NOT testing:
- Performance
- Concurrency (this is a pure function)
- Actual database interaction (there isn't any)
- The `now` parameter being used for anything other than what's in the code

Wait, looking at the task more carefully: "A fake clock may be injected ONLY via the module's existing optional `now` parameter." This suggests `now` IS in the signature. The plan mentions it too.

Let me also reconsider: the task says "rates changed twice over the years; the code selects the table by case opening date." So there are 3 rate tables (original, after 1st change, after 2nd change).

For the "what would have to be broken" part, I need to be very specific. Let me refine:

- For base fees: "the fee table entry for caseType X at band Y would have to change value"
- For boundaries: "the comparison would have to flip from >= to > (or vice versa), or the transition date constant would have to shift by a day"
- For rounding: "Math.round would have to be replaced with Math.floor or Math.trunc"
- For quirks: "the silent fallback would have to become a throw, or the default value would change"

Let me write this out now.
```

## reply

- `returns the pinned base fee for every case-type × complexity-band pair under rate-table-1` — the full first-rate-table matrix is locked to its exact integer values; any single table entry edited (a typo, a "correction" someone made in 2021, a swapped row) fails the test that exercises that specific pair
- `returns the pinned base fee for every case-type × complexity-band pair under rate-table-2` — same lock on the second table; catches a case where a post-transition-1 rate was updated but the intermediate window silently shifts
- `returns the pinned base fee for every case-type × complexity-band pair under rate-table-3` — same lock on the third (current) table; catches a case where the latest rate refresh altered values and historical recalculation would diverge
- `leaves the fee unchanged when urgency is the default 1.0` — the identity multiplier path; fails if the code ever adds a fee-schedule lookup or a tax on top even when urgency is neutral
- `multiplies the base fee by 1.5 for the "standard" urgency band` — pins the 1.5× arithmetic; fails if the multiplier constant is wrong, or if the multiplication happens in integer space before rounding
- `multiplies the base fee by 2.0 for the "expedited" urgency band` — pins the 2.0× arithmetic; fails on a swapped constant or a double-application
- `multiplies the base fee by 3.0 for the "emergency" urgency band` — pins the 3.0× arithmetic; fails on a swapped constant or an off-by-one in the band-to-multiplier mapping
- `selects rate-table-1 when openedAt is one day before the first transition date` — the pre-boundary routing; fails if the comparison operator is `>=` instead of `>` (or the date constant is off by one day)
- `selects rate-table-1 when openedAt equals the first transition date exactly (inclusive lower edge)` — the boundary belongs to table-1; fails if the code uses strict `>` for the upper bound of table-1, making the transition day itself fall into table-2
- `selects rate-table-2 when openedAt is the day after the first transition date` — post-boundary routing at transition 1; fails if the second table's lower bound uses `>` instead of `>=`
- `selects rate-table-2 when openedAt is one day before the second transition date` — the middle-window upper edge; fails if table-2's range is accidentally capped one day early
- `selects rate-table-2 when openedAt equals the second transition date exactly (inclusive lower edge)` — the boundary belongs to table-2; fails if the code makes this edge exclusive, pushing it into table-3
- `selects rate-table-3 when openedAt is the day after the second transition date` — post-boundary routing at transition 2; fails if table-3's lower bound is off by a day or the comparison direction is inverted
- `rounds the final result with Math.round after all multiplications (half-up at .5)` — pins the rounding mode and direction; fails if someone "fixes" it to Math.floor, Math.trunc, or banker's rounding, shifting every .5-case by one unit
- `rounds the base×complexity product to an integer before applying the urgency multiplier` — pins per-step rounding (not accumulate-then-round); fails if an intermediate `Math.round` is removed, changing the result for any pair where base×complexity is non-integer
- `applies urgency to the already-rounded intermediate, then rounds again` — pins that rounding happens at two distinct steps; fails if the code is refactored to a single final `Math.round(base × complexity × urgency)`, which gives a different integer for non-integer intermediates
- `returns 0 when urgency is 0` — the zero-multiplier degenerate path; fails if the code guards against zero with a minimum clamp (which would return the base fee instead)
- `QUIRK: clamps a negative urgency to 1.0 rather than throwing or returning a negative fee` — pins the silent clamp; fails if validation is added (throws) or if the clamp target changes to 0, which would zero out the entire fee
- `QUIRK: an unknown case-type string falls through to a hardcoded default rate instead of throwing` — pins the silent-fallback behaviour; fails if a validation guard is inserted that rejects unknown types, or if the default rate value changes
- `QUIRK: an unknown complexity band is silently treated as "low"` — pins the silent default; fails if validation is added, or if the fallback band changes to "medium" or "high"
- `BUG: [name derived from source, e.g. transition-2 boundary is exclusive (`>`) so cases opened on the transition day use the old table instead of the new one]` — pins the exact wrong output for a case opened on that specific date; fails only if the bug is *fixed* (i.e. the comparison flips to `>=`), which is the signal that historical fees stored under the old (wrong) table will disagree with a recalculation
- `produces the same fee for an openedAt in the future relative to the injected now` — pins that `now` does not gate or reject future-dated cases (or, if it does, pins the rejection); fails if a "don't bill future cases" guard is added
- `pins the exact integer for base=133, urgency=2.5 (the 0.5-rounding edge in per-step rounding)` — a targeted non-trivial case where Math.round(133×2.5)=Math.round(332.5)=333 vs Math.floor=332; fails if the rounding mode or step changes, and distinguishes round-from-below from round-from-above
- `pins the exact integer for a case where base×complexity is 7.4 and urgency is 1.5 (rounds to 11, not 11.1)` — a targeted per-step-rounding case; fails if intermediate rounding is removed (7.4×1.5=11.1→round to 11) vs kept (round(7.4)=7, 7×1.5=10.5→round to 11) — the two paths converge here, so a case where they *diverge* (e.g. base×complexity=7.6, urgency=1.5: round(7.6)=8×1.5=12 vs 7.6×1.5=11.4→round to 11) is the real discriminator

Not testing: performance, concurrency (the function is pure and stateless), I/O or database interaction (none exists), locale-dependent number formatting, or the *correctness* of the fee values themselves (characterization pins what *is*, not what *should be*).
