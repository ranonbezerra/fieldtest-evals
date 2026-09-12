# FINDINGS — `feeCalculator.ts` (characterization)

Companion to `test/fee-calculator.spec.ts`, which pins the module's current
behavior exactly, quirks included. Test names flagged `(BUG-n)` / `(QUIRK-n)`
map 1:1 to the entries below.

**Constraints honoured**
- Production code untouched: `feeCalculator.ts` is unchanged.
- The fake clock is injected ONLY through the module's existing optional
  `now` parameter; the suite never omits `now` on clock-sensitive calls.
- Fully deterministic: no real dates, no randomness.
- The fixes below are **proposals only — none are applied.**

## BUG-1 — Cases opened exactly on 2022-07-01 are billed on the 2021 table

**Where.** `tableFor()`: the 2021 transition uses `openedAt >= REVISION_2021`
(inclusive) but the 2022 transition uses `openedAt > REVISION_2022` (strict).

**Reproducing input / output.**
```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' })
// -> { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }
```
The module header says `2022-07: rate revision (see RATE_TABLE_2022)`, i.e. the
2022 table (`bandFee: 15000`) was supposed to take effect on that day.

**Blast radius.** Every case opened on 2022-07-01 (one day) was billed at 2021
rates: under-billed in all 16 type×band cells (STANDARD band 1: -$15.00, up to
APPEAL band 4: -$100.00 on the base fee), and urgent cases additionally lost
the 15% -> 18% urgency bump introduced by the same revision. Stored, audited
historical fees for that day contradict the published rate schedule.

**Proposed fix (not applied).** `if (openedAt >= REVISION_2022)`. Requires
billing sign-off and a reconciliation of the affected day before shipping,
because it changes billed amounts.

## BUG-2 — The urgency surcharge applies when the deadline has already passed

**Where.** `daysBetween(ref, c.deadline) <= 7` is also true for negative day
counts, i.e. any deadline in the past.

**Reproducing input / output.**
```ts
calculateFee(
  { type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-02-25' },
  '2023-03-10', // `now`; the deadline is 13 days in the past
)
// -> { table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 }
```
Intended reading: urgency = deadline within the next 0..7 days.

**Blast radius.** Any recomputation of a case whose deadline had already
passed at calculation time (audit reruns, corrections, rebilling) is inflated
by 15–18% of the band fee, plus compounded expedited on top. If billing ever
ran stored cases through this path with a late `now`, those historical outputs
are overstated. Combined with QUIRK-5, the urgency fee silently depends on
when the fee is (re)calculated.

**Proposed fix (not applied).**
`const days = daysBetween(ref, c.deadline); if (days >= 0 && days <= 7) { ... }`

## QUIRK-1 — Unknown or misspelled case type silently falls back to STANDARD

**Where.** `if (!bands) bands = table.base['STANDARD'];` — the lookup is
case-sensitive, so `'standard'`, `'Commercial'`, whitespace variants, etc.,
all fall back as well.

**Reproducing input / output.**
```ts
calculateFee({ type: 'BANKRUPTCY', complexity: 2, openedAt: '2020-01-15' })
// -> { table: '2019', bandFee: 18500, ... } // STANDARD band 2, no error
```

**Blast radius.** Legacy imports with bad type strings are silently mispriced
with no error and no log. Example: a COMMERCIAL case recorded as
`'commercial'` pays the STANDARD band (2019 band 1: $120.00 instead of
$220.00) — invisible in audits.

**Proposed fix (not applied).** Throw on an unrecognized type (or, if the
old-system casing is known, an explicit legacy-alias map), plus an alert on
fallback.

## QUIRK-2 — Non-integer complexity escapes the band guard (NaN fee) or is silently coerced

**Where.** The guard handles `!band || band < 1` and `band > 4`, but not
non-integers: `bands[2.5 - 1]` reads index `1.5` -> `undefined`. Separately,
`NaN` is caught by `!band` and silently becomes band 1.

**Reproducing input / output.**
```ts
calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2020-01-15' })
// -> { table: '2019', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
calculateFee({ type: 'STANDARD', complexity: NaN, openedAt: '2020-01-15' })
// -> band 1 fee (12000), no error
```

**Blast radius.** `JSON.stringify(NaN)` is `null`: a single corrupted or
legacy fractional complexity writes a **null fee** into billing exports, and
any sum that includes the NaN poisons to NaN. The NaN-complexity path is
quieter: an intended band 3/4 is silently billed at band 1.

**Proposed fix (not applied).**
`if (!Number.isInteger(c.complexity) || c.complexity < 1 || c.complexity > 4) throw ...`
(reject, or clamp deliberately with a log — billing to decide).

## QUIRK-3 — Expedited surcharge compounds on (bandFee + urgencyFee); rounding is per-step, half-up

**Where.** `expeditedFee = pctOf(bandFee + urgencyFee, table.expeditedPct)`
with `pctOf = Math.round`. The comment "percent added when expedited" never
says whether the urgency fee is part of the base — the code includes it.

**Reproducing input / output.**
```ts
calculateFee(
  { type: 'STANDARD', complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17', expedited: true },
  '2020-06-10',
)
// bandFee 18500, urgencyFee 2775, then 10% of 21275 = 2127.5 -> 2128, total 23403
```
Without compounding the expedited fee would be 1850 and the total 23125.

**Blast radius.** Every urgent+expedited case in the stored history carries
the compounding and the per-step half-up rounding. Any "correction" re-prices
a large slice of historical fees; a re-implementation that rounds at a
different step (or uses a different rounding mode) will show unexplained
deltas against audited outputs. Note: with the current tables all band fees
are whole dollars, so only the expedited step actually rounds today — a
future sub-dollar table would make the urgency step round too.

**Proposed fix (not applied).** Billing to confirm the intended base; if
compounding is wrong, run a reconciliation report over stored fees before any
rebilling.

## QUIRK-4 — Rate-table selection is a lexicographic string compare on `openedAt`

**Where.** `tableFor()` compares date strings directly. Correct for canonical
`YYYY-MM-DD`, wrong for other ISO spellings.

**Reproducing input / output.**
```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' })           // table '2021', 13500
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01T00:00:00Z' }) // table '2022', 15000
```
Same moment, different table, because `'2022-07-01T00:00:00Z' > '2022-07-01'`
as strings.

**Blast radius.** Any caller passing a datetime (the field comment says
"ISO date", and ISO also covers datetimes) silently switches rate tables
around the revision boundaries — including interacting with BUG-1 at the
2022-07-01 boundary.

**Proposed fix (not applied).** Normalize/validate `openedAt` to `YYYY-MM-DD`
at the entry point (or compare parsed dates).

## QUIRK-5 — `now` falls back to the real clock when omitted

**Where.** `const ref = now ? now : new Date().toISOString().slice(0, 10);`

**Behavior pinned.** The suite always injects `now`; the fallback is not
exercised (it is inherently non-deterministic). As written, the urgency fee of
a stored case depends on when the fee is (re)calculated, and a deadline aging
into the past flips the fee into the BUG-2 regime.

**Proposed fix (not applied).** Make the reference date an explicit, required
argument (or always pass it from the caller's transaction time).

## QUIRK-6 — Empty-string deadline is treated as "no deadline"

**Where.** `if (c.deadline && ...)` — any falsy deadline (`''`) skips the
urgency check entirely.

**Reproducing input / output.**
```ts
calculateFee(
  { type: 'STANDARD', complexity: 2, openedAt: '2020-01-15', deadline: '' },
  '2020-06-10',
)
// -> urgencyFee 0 (no surcharge)
```

**Blast radius.** A case that truly had a near deadline but an empty string
recorded for it is billed without the urgency surcharge. Low likelihood,
silent, and un-auditable.

**Proposed fix (not applied).** Treat `deadline === ''` as invalid input
(reject or normalize upstream) rather than as absent.

## Note — header provenance mismatch (unresolved)

The header says `2020-03: added URGENT tier after the Silva case`, but
`CaseType` has no URGENT member and no table carries URGENT-specific rates;
urgency is modeled purely as deadline proximity. The comment and the code do
not describe the same feature — flag to billing before any restructuring. The
suite pins what the code actually does.

## Pinned as-is (assumed intended, no change proposed)

- Band clamping: `complexity` 0 / negative -> band 1; > 4 -> band 4.
- Opening dates before 2019 still select the 2019 table (no lower bound).
- 2021 transition lower edge inclusive (`2021-01-01` -> 2021 table).
- Urgency window inclusive at 7 days (`days <= 7`), 0 days included.
- `total` is the plain sum of the three parts — no final rounding step.
