# FINDINGS — `feeCalculator.ts` characterization

Companion to `test/fee-calculator.spec.ts`. The suite pins what `calculateFee` does
**today**. Every finding below is pinned **as it is**: the test asserts the current
output exactly, and the test name says so. **No fix in this document has been applied**
— `feeCalculator.ts` is byte-identical to what it was before this work.

Conventions:
- "Reproducing input" is the exact `calculateFee` call. The second argument is the
  module's existing optional `now` parameter — the only clock seam used anywhere.
- "Current output" is the exact returned `FeeBreakdown`.
- The matching test is named with a `[KNOWN BUG]` or `[PINNED QUIRK]` prefix.

## F1 — the 2022 rate revision does not apply on its own day (likely bug)

`tableFor` selects with `openedAt >= '2021-01-01'` (inclusive) but
`openedAt > '2022-07-01'` (strict). A case opened **on** 2022-07-01 gets the 2021
table. The header comment says "2022-07: rate revision", and the 2021 boundary is
inclusive — the asymmetry is almost certainly an off-by-one, not a policy.

Reproducing input:

```js
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }

calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-02' }, '2023-01-15')
// => { table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 }
```

The urgency rate on that same day is also the 2021 one (15%, not 18%):

```js
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01', deadline: '2023-01-20' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 }
// (openedAt '2022-07-02' instead => urgencyFee 2700, total 17700)
```

**What it probably intended:** `>=`, matching the 2021 revision boundary.

**Blast radius:** every case opened exactly on 2022-07-01 was billed at 2021 rates.
Per case, underbilled by the 2021→2022 base delta for its band (STANDARD band 1:
1500 cents … APPEAL band 4: 10000 cents); urgent cases opened that day also earned
15% instead of 18%. All of these outputs are stored and feed the annual audit.
The population is one calendar day of case openings — small unless a batch import
landed on that date, in which case it is concentrated.

**Proposed fix (NOT applied):** change `if (openedAt > REVISION_2022)` to
`if (openedAt >= REVISION_2022)`. If it is ever applied, the F1 test will fail by
exactly the deltas above — that failure is the audit-relevant diff to reconcile.

Pinned by: `[KNOWN BUG] the 2022 revision day (2022-07-01) ...`.

## F2 — table selection is lexicographic string comparison (latent quirk)

`tableFor` compares `openedAt` as a string against `'2021-01-01'` / `'2022-07-01'`.
For the documented `YYYY-MM-DD` format, lexicographic order equals chronological
order. But a string with a time component is lexicographically **greater** than the
bare date, so it flips the strict `>` at the 2022 edge:

Reproducing input:

```js
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, ... }

calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01T00:00:00' }, '2023-01-15')
// => { table: '2022', bandFee: 15000, ... }
```

Same calendar day, different table. (At the 2021 edge both bare and stamped
`2021-01-01...` select 2021, so only the 2022 edge visibly disagrees.)

**What it probably intended:** compare calendar dates.

**Blast radius:** latent. Only bites if a stored `openedAt` ever carries a time
component or a non-ISO shape — i.e. data imported from another system. Any such
value on/after 2022-07-01 silently took the 2022 table.

**Proposed fix (NOT applied):** normalize before comparing, e.g.
`const d = openedAt.slice(0, 10)`, or compare parsed `Date`s.

Pinned by: `[PINNED QUIRK] a datetime-stamped openedAt on 2022-07-01 ...`.

## F3 — a deadline in the past still earns the urgency fee (likely bug)

The urgency test is `daysBetween(ref, deadline) <= 7` with **no lower bound**. Any
negative day count satisfies `<= 7`, so a case whose deadline passed 400 days before
fee generation is "urgent".

Reproducing input:

```js
calculateFee(
  { type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: '2020-01-01' },
  '2023-01-15',
)
// => { table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 }
```

`deadline: '2020-01-01'` is 1110 days before `now`.

**What it probably intended:** urgent only inside a window, i.e. `0 <= days <= 7`.
Honest caveat: "overdue cases are urgent" is a *plausible* intended policy too, and
the code cannot be read to settle it — see Open questions.

**Blast radius:** the widest of the findings. Every case whose deadline had already
passed at fee-generation time carries a 15% (pre-2022) or 18% (2022) urgency fee on
top of its band fee, in the stored, audited record. If billing's mental model is a
7-day-forward window, this is systematic overbilling across the overdue population.

**Proposed fix (NOT applied):**
`const days = daysBetween(ref, c.deadline); if (c.deadline && days >= 0 && days <= 7)`.
Confirm with billing before treating as a bug.

Pinned by: `[KNOWN BUG] a deadline in the past still earns the urgency fee ...`.

## F4 — fractional complexity yields `undefined` band fee and `NaN` total (bug)

`complexity` is typed `number | null` with a `1..4` band comment, but nothing
enforces integrality. `band = 2.5` passes both clamps and indexes `bands[1.5]`:

Reproducing input:

```js
calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2021-06-15' }, '2023-01-15')
// => { table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
// JSON.stringify(...) => '{"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}'
```

With a deadline added, `urgencyFee` becomes `NaN` as well (`pctOf(undefined, 15)`).
Adjacent degenerate inputs behave, by contrast: `0.5` is caught by `band < 1` and
clamps to band 1; `NaN`/`0` are caught by the falsy `!band`; negatives clamp to band 1;
`> 4` clamps to band 4.

**What it probably intended:** reject or normalize non-integer bands.

**Blast radius:** if a fractional band ever reached billing, the stored record
silently loses `bandFee` (JSON drops `undefined` keys) and stores `total: null` —
audit corruption no alert would raise, or a crash in any downstream consumer doing
arithmetic on the fee.

**Proposed fix (NOT applied):** before clamping,
`if (!Number.isInteger(band)) throw new Error('complexity must be an integer band 1..4')`.

Pinned by: `[PINNED QUIRK] complexity 2.5 (fractional) ...`.

## F5 — unknown case types silently fall back to STANDARD, with no marker

`bands = table.base[c.type]; if (!bands) bands = table.base['STANDARD']`. The inline
comment says this is intentional for old-system imports; the quirk is that the output
carries **no trace** of the fallback. The lookup is also case-sensitive, so
`'standard'` falls back too.

Reproducing input:

```js
calculateFee({ type: 'PROBATE', complexity: 2, openedAt: '2021-06-15' }, '2023-01-15')
// => { table: '2021', bandFee: 20500, urgencyFee: 0, expeditedFee: 0, total: 20500 }
// identical in shape to a genuine { type: 'STANDARD', complexity: 2 } case

calculateFee({ type: 'standard', complexity: 1, openedAt: '2021-06-15' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }

calculateFee({ type: '', complexity: 1, openedAt: '2021-06-15' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }
```

**What it probably intended:** the defaulting is deliberate per the comment; the gap
is observability.

**Blast radius:** every historical fee for an imported/mistyped case is a STANDARD
fee with no marker. An audit that later learns the true type cannot distinguish
"billed as STANDARD because it is one" from "billed as STANDARD because it fell
back". Case-sensitivity widens the population to any non-uppercase type spelling.

**Proposed fix (NOT applied):** add a `typeFallback: true` field to the breakdown
(breaks the output shape — needs billing sign-off) or reject unknown types at the
API boundary where the data is imported.

Pinned by: `[PINNED QUIRK] unknown type "PROBATE" ...` (×3 tables) and the
case-sensitivity / empty-string tests.

## F6 — rounding rule, pinned: `Math.round` per step, halves up, applied more than once

`pctOf` rounds **at each step**: the urgency fee is rounded, and the expedited fee is
then computed from `bandFee + urgencyFee` — i.e. from the *already-rounded* urgency
fee — and rounded again. Two observations, both pinned:

1. **The exact rule is `Math.round` (halves toward +∞, not banker's), and it fires.**
   The only half-cent cases in the current data are in the 2019 urgent+expedited
   column:

   ```js
   // 18500 * 15% = 2775 exact; (18500 + 2775) * 10% = 2127.5
   calculateFee({ type: 'STANDARD', complexity: 2, openedAt: '2020-06-15', deadline: '2023-01-20', expedited: true }, '2023-01-15')
   // => { table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 }
   // COMMERCIAL band 2: 3622.5 -> 3623 (total 39848);  ESTATE band 3: 4542.5 -> 4543 (total 49968)
   ```

   And in 2022, where 18% urgency + 12% expedited produces genuine fractions, rounding
   goes to nearest, not up:

   ```js
   // (109000 + 19620) * 12% = 15434.4
   calculateFee({ type: 'APPEAL', complexity: 4, openedAt: '2023-01-01', deadline: '2023-01-20', expedited: true }, '2023-01-15')
   // => { table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 15434, total: 144054 }
   ```

2. **The second rounding step is currently dormant on its input side.** Every band fee
   in all three tables is a multiple of 100 cents, and 15%/18% of a multiple of 100 is
   always an integer — so the urgency step never actually rounds today, and the
   expedited step sees an exact sum. Sequential rounding is therefore
   **indistinguishable from single rounding under the current data**, but it would
   diverge the moment a future rate revision introduced a band fee that is not
   divisible that way. The structure is pinned by the urgent+expedited matrix column
   so the divergence is visible the day it first happens.

**Blast radius:** the three 2019 half-cent cases and every fractional 2022
expedited case are baked into stored, audited fees. "Fixing" rounding to banker's
rounding or floor changes them.

**Proposed fix:** none — this is the implemented rule, pinned so any future change
is deliberate. If billing wants a different rule, that is a separate decision with a
reconciliation plan, not a drive-by.

Pinned by: the four `[PINNED]` rounding tests and the urgent+expedited matrix column.

## Behaviours pinned that look intentional (not findings)

- `complexity` of `0`, negative, or `NaN` clamps to band 1; `> 4` clamps to band 4.
  Lenient clamping, no error — pinned in the degenerate-inputs block.
- `complexity: null` **and** a missing key (`undefined`) both throw
  `Error('complexity is required')`. The `undefined` branch is live in practice: a
  JSON record without the key yields `undefined`, not `null`.
- No lower bound on `openedAt`: cases opened before 2019 still get the "2019" table.
- The urgency window is 8 calendar days inclusive: `daysBetween(now, deadline) <= 7`,
  i.e. 0..7 days out. Pinned on both sides of the edge (7 → urgent, 8 → not).

## Open questions (honest gaps)

1. **The default clock is untested, on purpose.** When `now` is omitted the module
   calls `new Date().toISOString().slice(0, 10)` — the UTC calendar day at call
   time. Testing that path would make the suite non-deterministic, so every test in
   this suite passes an explicit `now`. Consequence for production: urgency depends
   on the UTC date fee generation runs on; on a machine west of UTC that boundary can
   differ from the local business day. Call patterns (when does billing run?) are not
   visible from this repo.
2. **`daysBetween` floors the millisecond delta.** For bare `YYYY-MM-DD` strings both
   endpoints parse as UTC midnight, so the division is exact and the floor is a no-op.
   If a caller ever passed a datetime deadline, N days + 23 hours would count as N
   days, widening the urgent window by up to a day. Untested: off the documented
   input contract.
3. **F1 and F3 are "likely bug" rather than "bug".** The code cannot settle whether
   the exclusive 2022 edge (F1) or overdue-urgency (F3) is a mistake or a policy.
   Both are pinned as-is either way; resolving them is the job of the next issue,
   with billing's confirmation.
4. **Fractional-band reachability is unverified.** Nothing in the repo shows a
   fractional `complexity` ever reaching billing (F4). It is pinned because the type
   allows it and the failure mode (stored `total: null`) is silent.

## Determinism

No test uses `new Date()`, the default `now`, or randomness. Every date is a literal
`YYYY-MM-DD` string parsed by the module as UTC midnight; table selection is string
comparison. The suite produces identical results on any machine, any timezone, any
day — run it twice, run it in CI, run it in two years.
