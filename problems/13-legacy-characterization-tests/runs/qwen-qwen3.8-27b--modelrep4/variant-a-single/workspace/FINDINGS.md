# FINDINGS — `feeCalculator.ts` (characterization baseline)

Companion to `test/fee-calculator.spec.ts`, which pins the module's **current**
behavior — quirks and bugs included — ahead of planned changes. The production
module is untouched; the only injection point the suite uses is the module's
existing optional `now` parameter, and every test passes it explicitly (the
suite is fully deterministic).

Each finding lists the reproducing input, what the module currently returns,
the likely blast radius (the stored, audited historical fee ledger is the
primary consumer), and the fix that would be proposed — **not applied**. Every
finding has a named test in the suite pinning the current behavior.

Severity key:
- **BUG** — almost certainly wrong; stored/audited amounts are affected.
- **QUIRK** — undocumented behavior that consumers may rely on; do not change
  casually.

## F-1 — BUG — the 2022 rate-revision edge is exclusive: cases opened on 2022-07-01 are billed at 2021 rates

**Where:** `tableFor()` — `if (openedAt > REVISION_2022)` (strict `>`), while
the 2021 edge is inclusive: `openedAt >= REVISION_2021`.

**Reproducing input:**
```ts
calculateFee({ type: 'APPEAL', complexity: 4, openedAt: '2022-07-01' }, '2031-01-01')
// -> { table: '2021', bandFee: 99000, urgencyFee: 0, expeditedFee: 0, total: 99000 }

calculateFee({ type: 'APPEAL', complexity: 4, openedAt: '2022-07-02' }, '2031-01-01')
// -> { table: '2022', bandFee: 109000, urgencyFee: 0, expeditedFee: 0, total: 109000 }
```
The 2021 transition day (`2021-01-01`) does move to the new table; the 2022
transition day does not. The asymmetry reads as an operator slip.

**Pinned by:** `rate-table boundaries` → `BUG: the 2022 revision day itself
(2022-07-01) STAYS on the 2021 table (exclusive edge, unlike 2021-01-01)`.

**Blast radius:** every case opened exactly on 2022-07-01 was billed at 2021
rates. Understatement on the band fee alone, by type/band 1–4: STANDARD
$15/$20/$30/$45, COMMERCIAL $25/$35/$50/$75, ESTATE $20/$30/$45/$65, APPEAL
$35/$45/$65/$100 — plus a smaller urgency add-on when urgent (15% instead of
18%) and a smaller expedited base. Those invoices are in the audited
historical ledger; re-running the module reproduces the same values, so the
ledger is self-consistent but not consistent with the revision's effective
date. Because of F-2, the same calendar day can also appear at 2022 rates when
its date string carries a time suffix — two fee schedules for one day.

**Proposed fix (not applied):** make the edge inclusive
(`openedAt >= REVISION_2022`) or, better, compare parsed dates (see F-2). Then
enumerate all cases opened on 2022-07-01, recompute at 2022 rates, and issue
credits/re-invoices. The pinned test must be rewritten in the same change.

## F-2 — QUIRK — table selection compares date strings lexicographically, not chronologically

**Where:** `tableFor()` compares the raw `openedAt` string against
`'2021-01-01'` / `'2022-07-01'`.

**Reproducing input:**
```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-6-15' }, '2031-01-01')
// -> table: '2022', bandFee: 15000   (June 15, 2022 is BEFORE July 1, 2022)

calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01T00:00:00Z' }, '2031-01-01')
// -> table: '2022', bandFee: 15000   (same calendar day as F-1's '2022-07-01' -> '2021')
```

**Pinned by:** `QUIRK: table selection compares date strings
lexicographically, not chronologically` (both tests).

**Blast radius:** any row whose date is not zero-padded ISO (legacy imports,
manual entries) can select the wrong table in either direction; two
representations of the same day produce different fees (interacts with F-1).
Silent — no error or log.

**Proposed fix (not applied):** normalize before comparing — parse to a
`Date` and compare timestamps, or coerce to canonical `YYYY-MM-DD` and reject
unparseable strings.

## F-3 — QUIRK — urgency is `days(now → deadline) <= 7`: inclusive at 7, and overdue deadlines stay urgent forever

**Where:** `if (c.deadline && daysBetween(ref, c.deadline) <= 7)`.

**Reproducing input** (2022 table, STANDARD band 1 = 15000, urgency 18% = 2700):
```ts
now '2023-06-15', deadline '2023-06-22'  // +7 days  -> urgencyFee 2700 (inclusive edge)
now '2023-06-15', deadline '2023-06-23'  // +8 days  -> urgencyFee 0
now '2023-06-15', deadline '2023-06-01'  // -14 days -> urgencyFee 2700 (overdue still urgent)
```

**Pinned by:** `urgency surcharge (deadline vs `now`)` — the 7-day/8-day edge
tests and `QUIRK: an overdue deadline (in the past) still triggers the
surcharge`.

**Blast radius:** every past-deadline case carries the 15%/18% surcharge
indefinitely; historical fees for stale cases embed it. If the intended rule
is "due within 7 days", deadlines in the past should not qualify — every such
case in the ledger is overstated.

**Proposed fix (not applied):** bound the window below as well
(`0 <= days <= 7`) unless overdue-urgent is documented policy; review the
historical delta for past-deadline cases before changing.

## F-4 — QUIRK — the expedited surcharge compounds on the urgency surcharge

**Where:** `expeditedFee = pctOf(bandFee + urgencyFee, table.expeditedPct)`.

**Reproducing input:**
```ts
calculateFee(
  { type: 'STANDARD', complexity: 2, openedAt: '2020-06-15', deadline: '2020-06-22', expedited: true },
  '2020-06-15',
)
// -> bandFee 18500, urgencyFee 2775, expeditedFee 2128, total 23403
//    10% is applied to 21275 (band + urgency), not to 18500 (which would be 1850)
```

**Pinned by:** `expedited surcharge` → `QUIRK: when urgent too, the expedited
percent is applied to bandFee + urgencyFee (compounded, not additive)`.

**Blast radius:** every case billed both urgent and expedited is higher than
the flat reading (in 2022 the effective uplift is ×1.18 × ×1.12 ≈ +32.2% vs
+30% flat). The breakdown's additive fields hide the compounding. Audited
totals encode it; a "fix" changes every historical urgent+expedited fee.

**Proposed fix (not applied):** decide the intended formula with billing; if
it changes, produce a per-case delta report for the urgent ∧ expedited
population first.

## F-5 — QUIRK — each surcharge is rounded to integer cents independently (half-up), before being summed

**Where:** `pctOf()` — `Math.round((amount * pct) / 100)`; the total is the
sum of the already-rounded parts.

**Reproducing input:**
```ts
2019 STANDARD band 2, urgent + expedited: 10% of 21275 = 2127.5 -> expeditedFee 2128, total 23403
2022 STANDARD band 4, urgent + expedited: 12% of 57820 = 6938.4 -> expeditedFee 6938, total 64758
```

**Pinned by:** `per-step rounding: each surcharge is rounded to integer cents
independently (half-up)` (both tests).

**Blast radius:** at most 1 cent per surcharge vs a round-at-the-end scheme;
billing reconciliation currently relies on the per-step order, so the order
is part of the audited contract.

**Proposed fix (not applied):** none, if this is the reconciled contract —
keep it documented. If rounding is ever centralized, recompute the ≤1-cent
historical deltas.

## F-6 — QUIRK — fractional complexity yields `bandFee: undefined` and `total: NaN`

**Where:** the band clamp only handles `!band`, `< 1`, and `> 4`; a value like
`2.5` survives to `bands[band - 1]` = `bands[1.5]` = `undefined`, and the
arithmetic turns into NaN.

**Reproducing input:**
```ts
calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2022-12-15' }, '2031-01-01')
// -> { table: '2022', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
```

**Pinned by:** `complexity: degenerate inputs` → `QUIRK: fractional complexity
(2.5) is not a valid array index: bandFee undefined, total NaN`.

**Blast radius:** the most dangerous degenerate path: a malformed import does
not fail, it produces a NaN fee that flows into billing exports (commonly
serialized as `null` or rejected downstream) — a silently corrupt row.
`complexity: null` / `undefined` do throw `'complexity is required'` (pinned
too), so only numeric garbage gets through.

**Proposed fix (not applied):** validate
`Number.isInteger(complexity) && complexity >= 1 && complexity <= 4` and
reject anything else.

## F-7 — QUIRK — zero/negative complexity is silently coerced to band 1; values above 4 to band 4

**Where:** `if (!band || band < 1) band = 1; if (band > 4) band = 4;`

**Reproducing input** (2022 table, STANDARD):
```ts
complexity 0  -> band 1 -> 15000
complexity -7 -> band 1 -> 15000
complexity 5  -> band 4 -> 49000
complexity 99 -> band 4 -> 49000
```

**Pinned by:** `complexity: degenerate inputs` (the four clamp tests).

**Blast radius:** bad complexity values are billed at the extreme bands —
0/negative at the cheapest (underbilling), huge at the most expensive
(overbilling) — with no error and no log. Any upstream step that maps a
missing value to `0` (instead of `null`, which throws) quietly produces band-1
fees.

**Proposed fix (not applied):** reject out-of-band integers instead of
clamping (fail closed), or at minimum alert when clamping fires.

## F-8 — QUIRK — unknown / unrecognized case types are silently billed as STANDARD; the lookup is case-sensitive

**Where:** `bands = table.base[c.type]` with a `table.base['STANDARD']`
fallback; `type` is an unchecked `string`.

**Reproducing input:**
```ts
type 'LIEN'     -> 22500  (2022 table, band 2 = STANDARD rate)
type 'TRUST'    -> 13500  (2021 table, band 1 — the fallback follows the table, not a fixed rate)
type ''         -> 22500
type 'standard' -> 22500  (lowercase misses the key, then falls back — same rate here, but the miss is real)
```

**Pinned by:** `case type: unknown / unrecognized types fall back to the
STANDARD fee` (all four tests).

**Blast radius:** any type absent from the table — a new type added without a
rate update, a typo, an old-system import — is billed at STANDARD. For
APPEAL- or COMMERCIAL-shaped cases that is a significant underbill, and
nothing is logged. Because the fallback uses the table selected by
`openedAt`, the error amount also varies by era.

**Proposed fix (not applied):** fail closed on unknown types (typed error),
or use an explicit fallback registry per type; at minimum, count/alert on
fallback hits.

## F-9 — QUIRK — `now` falls back to the real clock when omitted or empty

**Where:** `const ref = now ? now : new Date().toISOString().slice(0, 10);`

**Behavior:** `now: undefined` and `now: ''` both take the real-clock path.
The suite never depends on that path, except one test that pins it in a
date-independent way (deadline `2100-01-01`, so the urgency window can never
be hit by the fallback).

**Blast radius:** any caller that forgets `now` gets a result that drifts with
wall-clock time — the same input returns different fees on different days.
For historical re-runs (audit recomputation) this is a correctness hazard,
not just a testability one.

**Proposed fix (not applied):** make `now` mandatory (or default it to a
case-derived date) and reject empty strings.

## Suite notes

- Every expected value was produced by running the module as-is. Where a value
  is believed wrong (F-1 above all), the test keeps the current value on
  purpose — a future fix must deliberately rewrite that expectation.
- Determinism: no test reads the real clock, uses randomness, or depends on
  the run date. The only clock the module sees is the fixed string passed as
  `now`.
- Production code is untouched; the fake clock enters only through the
  module's existing optional `now` parameter.
