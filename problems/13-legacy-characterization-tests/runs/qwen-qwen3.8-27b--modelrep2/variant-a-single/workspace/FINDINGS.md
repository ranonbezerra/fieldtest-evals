# FINDINGS — feeCalculator.ts

Characterization findings for the case fee calculator (`feeCalculator.ts`, in
production since 2019; its outputs are stored and audited by billing).

## Method

- The suite is `test/fee-calculator.spec.ts`. **Production code is untouched.**
  Time is injected only through the module's existing optional `now`
  parameter; every call passes the fixed `now = '2024-01-15'`. No wall-clock
  reads, no randomness — the suite is fully deterministic.
- Every finding below is pinned **as it is** by a test whose name carries the
  same `[F-n / BUG]` or `[F-n / QUIRK]` tag. No proposed fix has been applied.
- The suite pins the historical rate tables and all surcharge arithmetic as
  literals (48 base pins + 3 × 48 modifier-matrix pins + 46 edge/degenerate
  pins, 238 tests total). Any change to rate data or math fails the suite.
- "Reproduction" snippets call `calculateFee` with literal arguments; the
  output shown is what the module produces today and what the suite asserts.

## Summary

| #   | Severity | Finding                                                                                  |
|-----|----------|------------------------------------------------------------------------------------------|
| F-1 | Bug      | 2022 rate-revision boundary is exclusive: cases opened on 2022-07-01 bill at 2021 rates  |
| F-2 | Bug      | Fractional complexity in (1,4) → `bandFee: undefined`, `total: NaN`                      |
| F-3 | Quirk    | Past (overdue) deadline still triggers the urgency surcharge                             |
| F-4 | Quirk    | Expedited % compounds on `bandFee + urgencyFee`, not on `bandFee`                        |
| F-5 | Quirk    | Unknown case type silently falls back to STANDARD rates                                 |
| F-6 | Quirk    | Type `"constructor"` / other prototype names → `bandFee: undefined`, `total: NaN`        |
| F-7 | Quirk    | Complexity 0 / negative / NaN silently clamped to band 1                                |
| F-8 | Quirk    | `daysBetween` floors: 7.5 days to deadline counts as 7 → urgent                          |
| F-9 | Quirk    | Falsy `now` falls back to the wall clock (non-deterministic) — documented, not assertable |
| F-10| Quirk    | Table selection is lexicographic string comparison (assumes zero-padded ISO dates)       |

---

## F-1 [BUG] — 2022-07-01 bills at 2021 rates (off-by-one on the second transition)

**Reproduction**

```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2024-01-15');
// → { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }
//   (the 2022 table would bill STANDARD band 1 at 15000)
```

**Root cause.** `tableFor` selects the table by string comparison:
`openedAt >= REVISION_2021` (inclusive) but `openedAt > REVISION_2022`
(strict). The two revision boundaries are treated inconsistently, so the
2022 table starts on 2022-07-02, one day after its own constant says it
should.

**Blast radius.** Every case opened on 2022-07-01 was billed at 2021 rates:
band delta from 1500¢ (STANDARD b1: 13500 vs 15000) up to 10000¢ (APPEAL b4:
99000 vs 109000), plus the lower 2021 urgency percent (15% vs 18%). Those
invoices are in the audited ledger. If the boundary is "fixed" without a data
correction, recomputation of historical bills for that day will diverge from
the stored figures; if it is left alone, the 2022 table has an unannounced
one-day hole and the next revision repeats the footgun.

**Proposed fix (not applied).** Unify the comparisons — `openedAt >=
REVISION_2022` if the revision was effective on the 1st — **only after**
billing signs off and all 2022-07-01 invoices are identified and
credited/re-billed. If the audited ledger is to remain the source of truth,
rename the constant to the true effective date (`'2022-07-02'`) and document
the boundary explicitly instead.

---

## F-2 [BUG] — fractional complexity in (1,4) yields `bandFee: undefined`, `total: NaN`

**Reproduction**

```ts
calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2019-06-15' }, '2024-01-15');
// → { table: '2019', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
```

Any non-integer strictly inside (1,4): 1.1, 1.5, 2.7, 3.99. With an urgent
deadline, `urgencyFee` becomes `Math.round(NaN)` → NaN as well; with
`expedited`, `expeditedFee` does too (pinned in the suite).

**Root cause.** The clamps cover `!band`, `band < 1`, and `band > 4`; there is
no integer normalization. `2.5` passes all three, `bands[1.5]` is
`undefined`, and `undefined + 0` produces `NaN` in `total`.

**Blast radius.** `complexity` is typed `number | null` and is "historically
not validated upstream". A single non-integer row produces a NaN total in the
billing ledger — silently, no exception — so downstream summing/formatting
renders "NaN" or throws, and the stored historical fee for that case is
unrecoverable.

**Proposed fix (not applied).** Normalize before indexing: `const band =
Math.min(4, Math.max(1, Math.trunc(c.complexity)))` (or `Math.round`), or
reject non-integers with an error; then audit historical invoices for NaN
totals and re-derive them from case records.

---

## F-3 [QUIRK] — past (overdue) deadline still triggers the urgency surcharge

**Reproduction**

```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2019-06-15', deadline: '2024-01-01' }, '2024-01-15');
// daysBetween = -14;  -14 <= 7  →  urgencyFee 1800
```

**Root cause.** `daysBetween(ref, c.deadline) <= 7` has no lower bound;
negative day counts (deadline already passed) satisfy the test.

**Blast radius.** Long-overdue cases keep the urgency percent
indefinitely. If "urgent" was meant as "deadline within the next 7 days",
every overdue invoice since 2020-03 is overcharged by 15–18% of the band fee.

**Proposed fix (not applied).** If overdue must not be urgent: `const d =
daysBetween(ref, c.deadline); if (d >= 0 && d <= 7)`. If overdue-urgent is
intentional, add a comment so a future refactor does not "fix" it and reprice
history.

---

## F-4 [QUIRK] — expedited % compounds on `bandFee + urgencyFee`

**Reproduction**

```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2019-06-15', deadline: '2024-01-22', expedited: true }, '2024-01-15');
// → expeditedFee 1380 = 10% × (12000 + 1800)
//   (a flat 10% of bandFee would be 1200)
```

**Root cause.** `expeditedFee = pctOf(bandFee + urgencyFee, table.expeditedPct)` —
the expedited percent is applied to the urgency-inclusive subtotal, not to
the band fee.

**Blast radius.** On urgent cases the effective expedited surcharge is 11.5%
of band (2019 table), 13.8% (2021) or 14.16% (2022) — the `expeditedPct`
field name understates it. Every urgent+expedited invoice since 2020-03
bakes in the compounding; switching to a flat percent would reprice all of
that history.

**Proposed fix (not applied).** Decide the contract with billing. If the
intent is a flat percent on the band fee: `pctOf(bandFee,
table.expeditedPct)`, plus a historical reconciliation.

---

## F-5 [QUIRK] — unknown case type silently falls back to STANDARD rates

**Reproduction**

```ts
calculateFee({ type: 'MUNICIPAL', complexity: 1, openedAt: '2019-06-15' }, '2024-01-15');
// → 12000 (2019 STANDARD band 1) — no error, no log
calculateFee({ type: 'commercial', ... });   // → 12000 (lookup is case-sensitive)
calculateFee({ type: 'COMMERCIAL ', ... });  // → 12000 (whitespace-sensitive)
calculateFee({ type: 'MUNICIPAL', complexity: 1, openedAt: '2023-03-15' }, '2024-01-15');
// → 15000 (falls back to the *selected table's* STANDARD)
```

**Root cause.** `bands = table.base[c.type]; if (!bands) bands =
table.base['STANDARD'];` — a silent fallback.

**Blast radius.** The code comment acknowledges "rare imports from the old
system". Mis-encoded types are billed at the wrong rate with no signal, and
the audit trail cannot distinguish a genuine STANDARD case from a fallback —
so the affected rows are not findable by query.

**Proposed fix (not applied).** Reject unknown types (throw upstream, or
return a `resource_not_found`-style error), or add a `fellBack: true` marker
to the breakdown so billing can flag and re-review those invoices.

---

## F-6 [QUIRK] — `type: "constructor"` (and other prototype names) → NaN total

**Reproduction**

```ts
calculateFee({ type: 'constructor', complexity: 1, openedAt: '2019-06-15' }, '2024-01-15');
// → { table: '2019', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
```

The same applies to `toString`, `valueOf`, `hasOwnProperty`, `__proto__`, and
any other `Object.prototype` name.

**Root cause.** `table.base` is a plain object literal; `base['constructor']`
resolves to the inherited `Object.prototype.constructor` **function**, which
is truthy, so the `if (!bands)` guard misses it. `bands[0]` on a function is
`undefined` → same NaN-ledger symptom as F-2.

**Blast radius.** Narrower than F-2 (requires an exact prototype-name type
string from the unvalidated legacy import path) but identical symptom:
silent NaN in the ledger.

**Proposed fix (not applied).** Guard with `Object.hasOwn(table.base,
c.type)`, or build the rate tables with `Object.create(null)`.

---

## F-7 [QUIRK] — complexity 0 / negative / NaN silently clamped to band 1

**Reproduction**

```ts
calculateFee({ type: 'STANDARD', complexity: 0,   openedAt: '2019-06-15' }, '2024-01-15'); // → 12000 (band 1)
calculateFee({ type: 'STANDARD', complexity: -3,  openedAt: '2019-06-15' }, '2024-01-15'); // → 12000
calculateFee({ type: 'STANDARD', complexity: 0.5, openedAt: '2019-06-15' }, '2024-01-15'); // → 12000
calculateFee({ type: 'STANDARD', complexity: NaN, openedAt: '2019-06-15' }, '2024-01-15'); // → 12000 (via !band)
```

**Root cause.** `if (!band || band < 1) band = 1;` silently downgrades
missing/invalid band data to the cheapest band.

**Blast radius.** Cases with a missing or corrupted complexity are billed at
band 1 instead of being rejected — a hidden undercharge (e.g. an APPEAL band
4 case mis-recorded as 0 loses 80000¢ on the 2019 table). Historical band-1
rows that were actually downgraded zeros are indistinguishable from genuine
band-1 cases.

**Proposed fix (not applied).** Validate `Number.isInteger(c.complexity) &&
c.complexity >= 1 && c.complexity <= 4` and throw otherwise; before doing
so, audit whether any historical band-1 rows look like downgraded invalid
input.

---

## F-8 [QUIRK] — `daysBetween` floors: a deadline 7.5 days out counts as 7 → urgent

**Reproduction**

```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2019-06-15', deadline: '2024-01-22T12:00:00Z' }, '2024-01-15');
// 7.5 days → Math.floor → 7 → urgencyFee 1800
// deadline '2024-01-22T23:59:59Z' → floor(7.9997) → 7 → urgent
// deadline '2024-01-23T00:00:00Z' → 8            → not urgent
```

**Root cause.** `daysBetween` returns `Math.floor(ms / 86400000)`; any
sub-day remainder drags a deadline that is truly up to 8 days away into the
`<= 7` window.

**Blast radius.** When `deadline` carries a time of day, the "7 days" urgency
window is effectively "strictly less than 8 days" — up to a full extra day
of urgency billing per case. Date-only deadlines (UTC midnight) are exact, so
the effect depends on input shape from the caller.

**Proposed fix (not applied).** Compare calendar dates: normalize both ends
to date-only (`toISOString().slice(0, 10)`) before diffing, if the contract
is "deadline within 7 days".

---

## F-9 [QUIRK] — falsy `now` falls back to the wall clock (documented, not assertable)

**Reproduction** (prose only — pinning this would require a real wall-clock
read, which the suite's determinism constraint forbids):

```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2019-06-15' }); // no `now`
// or: calculateFee({...}, '')  // empty string is falsy
// → urgency is computed against new Date().toISOString().slice(0, 10): the system clock
```

**Root cause.** `const ref = now ? now : new Date().toISOString().slice(0, 10);`

**Blast radius.** Any caller path that omits `now` makes urgency
non-deterministic and non-reproducible from stored data: historical invoices
cannot be recomputed without the original "now", and tests that omit it flake
across midnight / time zones.

**Proposed fix (not applied).** Make `now` a required argument (coordinate
with all callers), or default it to `openedAt` if "as-of opening" is an
acceptable semantics.

---

## F-10 [QUIRK] — table selection is lexicographic string comparison (assumes zero-padded ISO dates)

**Reproduction**

```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: 'January 5, 2021' }, '2024-01-15'); // → table '2022'
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '' }, '2024-01-15');                // → table '2019'
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-7-1' }, '2024-01-15');        // → table '2022'
```

The last case is the same calendar day as F-1's `'2022-07-01'` (→ `'2021'`) —
different padding, different rate table.

**Root cause.** `tableFor` compares the raw `openedAt` string against the
revision constants; correctness silently depends on zero-padded
`YYYY-MM-DD` format. Any other format (natural language, missing padding)
sorts arbitrarily against the constants.

**Blast radius.** Any non-ISO `openedAt` from the legacy import path selects
the wrong rate table — full invoice-level mispricing (band fee and all
surcharges), not just a surcharge skew.

**Proposed fix (not applied).** Validate/normalize `openedAt` at the
boundary: parse it, re-serialize to `YYYY-MM-DD` (reject unparseable values)
before the comparison.

---

## What the suite pins (at a glance)

- **48 base pins** — every case type × complexity band 1–4 in all three rate
  tables, with the `table` label, zero surcharges, and `total === bandFee`.
- **3 × 48 modifier-matrix pins** — urgent-only, expedited-only, and
  urgent+expedited for every type × band × table (table-dependent 15%/18%
  urgency, 10%/12% expedited, compounding, half-up rounding).
- **Boundary pins** — 2021-01-01 inclusive; 2022-07-01 exclusive (F-1,
  flagged); deadline 7d inclusive / 8d exclusive; sub-day flooring (F-8).
- **Degenerate-input pins** — null/undefined/zero/negative/fractional/NaN
  complexity; unknown, case-mismatched, whitespace-padded, empty, and
  prototype-name case types (F-2, F-5, F-6, F-7).
- **Rounding pins** — half-cent round-up and both-direction round-to-nearest
  expedited fees; whole-cent invariant and `total === bandFee + urgencyFee +
  expeditedFee` across all valid inputs.
- **Determinism pins** — identical calls yield identical breakdowns; `now`
  does not influence table selection.

All findings are pinned **as they are**: this suite passes on the unmodified
module today. After the planned modification it must pass again — except for
the specific `[BUG]`/`[QUIRK]` tests the team has explicitly decided to
change, and those changes are the only places where a diff is legitimate.
