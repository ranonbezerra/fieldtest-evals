# FINDINGS.md — `feeCalculator.ts` (characterization; no fixes applied)

Companion to `test/fee-calculator.spec.ts`. That suite pins **what the code
does today**, including the behaviours documented here. Nothing in this
document has been applied to the production module; `feeCalculator.ts` is
byte-identical to before this work.

## Reading the suite

- Tests prefixed `[PINNED BUG]` / `[PINNED QUIRK]` assert a surprising (or
  wrong) current output on purpose. If a later change fixes one of these
  behaviours, the corresponding test failing is *expected* — update the test
  and this document in the same PR.
- Every call injects a fixed `now = '2026-01-15'` via the module's existing
  optional parameter. The suite never relies on the real clock, on
  randomness, or on the host timezone (all dates are ISO date-only strings,
  which parse as UTC everywhere, so day arithmetic is exact).
- Base-fee literals in the suite are transcribed from the three
  `RATE_TABLE_*` constants. The suite fails if any of them change — that is
  the point.

## Summary

| # | Kind | Behaviour (as it is) |
|---|------|----------------------|
| F-1 | Likely bug | A case opened exactly on `2022-07-01` is billed at the old 2021 rates, not the 2022 rates |
| F-2 | Quirk, intent unknown | A deadline that has already passed still triggers the urgency surcharge |
| F-3 | Quirk, likely bug | Non-integer complexity inside 1..4 (e.g. `2.5`) yields `bandFee: undefined` and `total: NaN` |
| F-4 | Quirk, likely intentional | Unknown case types are billed at STANDARD rates |
| F-5 | Quirk | `0`, negative, or sub-1 complexity is silently billed as band 1 |
| F-6 | Observation | Rounding is per-step `Math.round`; the urgency step is a no-op for the current tables; the expedited step does the rounding, half-up, on `bandFee + urgencyFee` |
| F-7 | Observation | Rate-table selection is lexicographic **string** comparison, not date parsing |

---

## F-1 — The 2022 revision edge is exclusive (likely off-by-one bug)

**What the code does.** `tableFor()` selects the 2021 table with
`openedAt >= '2021-01-01'` but the 2022 table with
`openedAt > '2022-07-01'`. A case opened exactly on the second revision date
therefore gets the superseded 2021 table.

**Reproducing input.**

    calculateFee(
      { type: 'APPEAL', complexity: 4, openedAt: '2022-07-01' },
      '2026-01-15',
    )
    // => { table: '2021', bandFee: 99000, urgencyFee: 0, expeditedFee: 0, total: 99000 }

The 2022 rate for the same case is 109000 (pinned test:
`[PINNED BUG] 2022-07-01 ...`).

**What it probably intended.** The first transition is inclusive, and the
revision constants read as effective dates. The asymmetric `>=` / `>` looks
like an off-by-one — but see the open question below.

**Blast radius.** Every case opened exactly on `2022-07-01` — a full day of
intake — was billed at the old rates, and those totals are stored and feed the
annual audit. The understatement is the 2022 uplift per type/band (e.g.
APPEAL band 4: 10 000; ESTATE band 1: 2 000 cents), plus a different urgency
percentage (15% → 18%) on any of those cases that also qualified as urgent.

**Proposed fix (not applied).** Change the second comparison to
`openedAt >= REVISION_2022`. This changes behaviour for stored-and-audited
output on that one day, so it must ship with a billing sign-off and a
decision about retro-correcting historical fees — not as a silent change.

---

## F-2 — Overdue deadlines still trigger the urgency surcharge (intent unknown)

**What the code does.** Urgency is `daysBetween(now, deadline) <= 7` with no
lower bound. The day count is negative when the deadline has passed, and any
negative number is `<= 7`.

**Reproducing input.**

    calculateFee(
      { type: 'APPEAL', complexity: 3, openedAt: '2023-01-15', deadline: '2026-01-06' },
      '2026-01-15',   // deadline is 9 days in the past
    )
    // => { table: '2022', bandFee: 72500, urgencyFee: 13050, expeditedFee: 0, total: 85550 }

A deadline 9 days past — or 9 years past — still adds 18%.

**What it probably intended.** "Within 7 days of the deadline" plausibly means
`0..7` (same day included, overdue excluded). It is also *possible* the
business wants "at or past the deadline" to count as urgent; that cannot be
verified from the code.

**Blast radius.** Any case whose fee is generated more than 7 days after its
deadline carries the 15–18% surcharge. Fees are generated at some point after
opening, so this may be a large share of stored urgency-flagged fees.

**Proposed fix (not applied).** Constrain the window, e.g.
`days >= 0 && days <= 7`, after billing confirms what "urgent" means for a
past deadline.

---

## F-3 — Non-integer complexity inside 1..4 yields `undefined` / `NaN` (likely bug)

**What the code does.** The clamps catch `0` / negative / sub-1 (→ band 1)
and `> 4` (→ band 4), but a fractional band strictly inside `1..4` is used as
an array index: `bands[2.5 - 1]` → `bands[1.5]` → `undefined`.

**Reproducing input.**

    calculateFee(
      { type: 'STANDARD', complexity: 2.5, openedAt: '2020-05-01' },
      '2026-01-15',
    )
    // => { table: '2019', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }

With an urgent deadline and `expedited: true`, `urgencyFee` and
`expeditedFee` are `NaN` as well (`Math.round(NaN)` is `NaN`).

**Blast radius.** Depends on what billing persists for a `NaN` fee — see the
open questions. If stored raw, the audit contains a non-numeric fee for every
such case.

**Proposed fix (not applied).** Validate complexity as an integer in `1..4`
and throw like the `null` / `undefined` case (or `Math.round` it to a band,
if a default is preferred over rejection).

---

## F-4 — Unknown case types are billed at STANDARD rates (likely intentional)

**What the code does.** `table.base[c.type]` misses, and the code falls back
to `table.base['STANDARD']`.

**Reproducing input.**

    calculateFee(
      { type: 'FAMILY_LAW', complexity: 3, openedAt: '2021-06-01' },
      '2026-01-15',
    )
    // => { table: '2021', bandFee: 29500, urgencyFee: 0, expeditedFee: 0, total: 29500 }
    // (29500 is STANDARD band 3 in the 2021 table)

**Intent.** The inline comment ("unrecognized types were rare imports from
the old system; default them") suggests this is deliberate — but it silently
prices an unknown type at another type's rate, in either direction.

**Blast radius.** Every historical import whose type string no longer matches
a key is stored at STANDARD rates.

**Proposed fix (not applied).** An explicit legacy-type → band mapping, or a
hard error, per billing's decision.

---

## F-5 — Zero / negative / sub-1 complexity is silently billed as band 1

**What the code does.** `if (!band || band < 1) band = 1;` maps `0`,
negative values, and fractions below 1 to band 1 instead of rejecting them.

**Reproducing input.**

    calculateFee(
      { type: 'STANDARD', complexity: 0, openedAt: '2023-01-15' },
      '2026-01-15',
    )
    // => { table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 }
    // (15000 is band 1; band 2 would be 22500)

Same for `complexity: -3` and `complexity: 0.5` (pinned tests).

**Blast radius.** Under-billing whenever the true band was higher; silent, so
there is no error trail.

**Proposed fix (not applied).** Validate like the `null` case, or make the
default explicit and logged.

---

## F-6 — Rounding: per-step `Math.round`, half-up, and the expedited step compounds

**What the code does.** Each surcharge is `Math.round(amount * pct / 100)`
("rounded at each step since 2019; billing reconciles against these"), and
the expedited surcharge is computed on `bandFee + urgencyFee` — i.e. on the
already-rounded urgency fee (double rounding: more than once per total).

**Pinned in the suite.**

    // 2019 table, STANDARD band 2, urgent, expedited:
    // (18500 + 2775) x 10% = 2127.5 -> Math.round -> 2128   (halves round UP)
    // => total 23403

    // 2022 table, ESTATE band 1, urgent, expedited:
    // (21500 + 3870) x 12% = 3044.4 -> Math.round -> 3044
    // => total 28414

**Latent part.** For the current tables the urgency step never actually
rounds: every base fee is a multiple of 500 cents, and 15% / 18% of those are
whole cents. The per-step rounding on the urgency fee is therefore a no-op
today and only becomes observable if the rate tables change. The expedited
step is where rounding actually bites.

**No fix proposed** — this is documented behaviour billing reconciles
against; it is pinned so any future change to the rounding scheme is a
visible diff, not a silent one.

---

## F-7 — Table selection is lexicographic string comparison, not date parsing

**What the code does.** `tableFor()` compares the raw `openedAt` string
against the revision date strings. For well-formed `YYYY-MM-DD` dates that is
equivalent to date comparison. Otherwise:

- A datetime string sorts after its bare date:
  `calculateFee({ type: 'APPEAL', complexity: 4, openedAt: '2022-07-01T00:00:00' }, '2026-01-15')`
  selects the **2022** table, while the bare `'2022-07-01'` selects 2021
  (F-1). The same calendar instant can bill differently depending on the
  string format.
- Any string that sorts after `'2022-07-01'` (e.g. `'garbage'`) selects the
  2022 table.

**Blast radius.** Only if callers ever pass non-date strings; the interface
says ISO date, so this is currently latent.

**Proposed fix (not applied).** Parse and validate the date before comparing.

---

## Open questions (honest gaps — not determinable from the code alone)

1. **Was the `2022-07-01` exclusion intended?** (F-1) The asymmetric
   `>=` / `>` might encode a real decision (e.g. 2022 rates only effective
   from July 2). If so, F-1 is a quirk, not a bug. The suite pins the current
   behaviour either way.
2. **Do callers ever pass full ISO datetimes** (not date-only) for
   `openedAt` / `deadline`? That would change F-7 and make
   `daysBetween`'s `Math.floor` observable (a deadline with a time component
   shifts the day count).
3. **What does billing persist when a fee is `NaN` / `undefined`** (F-3)?
   Stored raw, coerced to 0, or rejected upstream? The blast radius of F-3
   depends on the answer.
4. **The real-clock fallback is out of scope by design.** When `now` is
   omitted the module uses `new Date().toISOString().slice(0, 10)` (a UTC
   date). The suite deliberately never exercises this path, so that
   behaviour is characterized by reading the code, not by a test.

## What this document is not

- Not a change plan. No fix above has been applied.
- Not an assertion of intended behaviour. The suite's job is to fail loudly
  when *anything* moves, so the next (actual) change can be reviewed against
  a known baseline of historical output.
