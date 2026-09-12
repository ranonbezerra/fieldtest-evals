# FINDINGS — `feeCalculator.ts`

Companion to the characterization suite `test/fee-calculator.spec.ts`. Every
item below is pinned AS IT IS by a flagged test in that suite (title prefix
`BUG:` or `QUIRK:`). No fix has been applied; the production file is
untouched. All reproductions are deterministic: the clock is injected
through the module's existing optional `now` parameter, and every date is a
fixed ISO date-only string (parsed as UTC, so timezone-independent).

Blast-radius context: this module's outputs are stored and audited by
billing. Every behavior below — quirk or bug — is already part of the
historical record, so any fix changes the meaning of existing rows and
needs a billing reconciliation before it ships.

## 1. BUG — the 2022 rate revision misses its own effective date

- Where: `tableFor()` — the 2022 cut uses a strict `>` (`openedAt > REVISION_2022`)
  while the 2021 cut uses `>=`.
- Reproducing input:
  - `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2022-07-01')`
    → `{ table: '2021', bandFee: 13500, ... }`
  - `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-02' }, '2022-07-01')`
    → `{ table: '2022', bandFee: 15000, ... }`
- Current behavior: a case opened exactly on 2022-07-01 is billed the 2021
  schedule — base fees roughly 9–10% lower, urgency 15% instead of 18%,
  expedited 12% on the smaller base. The 2022 rates only apply from
  2022-07-02.
- Blast radius: every stored/audited fee with `opened_at = '2022-07-01'`
  (one full day of intake, all types and bands, plus their surcharges) is
  under-charged relative to the intended 2022 schedule.
- Pinned by: `BUG: opened 2022-07-01 (second revision effective date) still
  gets the 2021 schedule`.
- Proposed fix (NOT applied): make the cut inclusive — `openedAt >= REVISION_2022`.
  Shipping it re-bills the 2022-07-01 cohort, so reconcile those rows with
  billing first.

## 2. QUIRK — `openedAt` is compared as a raw string, never parsed

- Where: `tableFor()` compares the input string directly against the
  revision constants.
- Reproducing input:
  - `openedAt: '2022-07-01T00:00:00Z'` → 2022 schedule
  - `openedAt: '2022-07-01'` → 2021 schedule (the same instant)
  - `openedAt: 'garbage'` → 2022 schedule
  - `openedAt: '2021/05/10'` → 2021 schedule
- Current behavior: lexicographic comparison decides the table. A
  datetime-stamped copy of the "buggy day" from #1 bills 2022 rates while
  the bare date bills 2021 rates (a longer string with the same prefix
  sorts after the prefix). Non-ISO values land in whichever table the
  string happens to sort into.
- Blast radius: rows imported with datetime or slash formats are bucketed by
  string accident, not by date. The historical record for 2022-07-01
  contains BOTH schedules, split by storage format.
- Pinned by: the three `QUIRK:` tests under "openedAt is compared as a raw
  string".
- Proposed fix (NOT applied): normalize before comparing — parse to a
  `Date` (or validate strict `YYYY-MM-DD` and reject anything else).

## 3. BUG — fractional complexity produces NaN fees

- Where: the clamping block `if (!band || band < 1) band = 1; if (band > 4)
  band = 4;` never rejects non-integers in [1, 4).
- Reproducing input:
  - `calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2021-06-15' }, '2021-05-10')`
    → `{ table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }`
    (`bands[2.5 - 1]` is an out-of-range array index → `undefined`;
    arithmetic on `undefined` → `NaN`.)
  - Same input with `expedited: true` → `expeditedFee: NaN` as well.
  - `complexity: NaN` takes the falsy branch and silently becomes band 1.
- Blast radius: any fee computed with a fractional complexity is NaN; if
  persisted it becomes a hole in billing aggregates, audits and JSON
  exports, with no error marker in the breakdown.
- Pinned by: the `BUG: fractional complexity 2.5 ...` tests.
- Proposed fix (NOT applied): validate `Number.isInteger(band)` and throw a
  typed error, or round intentionally (`Math.round`) and then clamp to 1..4.

## 4. QUIRK — degenerate complexity is silently clamped, not rejected

- Where: same clamping block.
- Reproducing input: `complexity: 0`, `-2`, `NaN` → band 1 fee;
  `complexity: 5`, `99` → band 4 fee. Only `null` / `undefined` throws
  (`'complexity is required'`).
- Blast radius: data-entry mistakes (a 0, an empty field parsed as 0) are
  billed as band 1 and are indistinguishable from genuine band-1 cases in
  the stored history. The only "validation" in the module is the missing-
  value throw.
- Pinned by: the `QUIRK: out-of-band complexity ...` tests.
- Proposed fix (NOT applied): reject out-of-range bands with a typed error,
  or record an explicit fallback flag in the breakdown so audits can see it.

## 5. QUIRK — unknown case type silently falls back to STANDARD

- Where: `if (!bands) bands = table.base['STANDARD'];`
- Reproducing input: `type: 'MARITIME'`, `type: ''`, `type: 'standard'`
  (lowercase) → STANDARD rates of whichever table the opened date selects
  (2021 table: 13500 for band 1; 2022 table: 15000).
- Blast radius: the `CaseType` union is decorative — the input field is a
  plain `string` — so old-system imports with unrecognized types were
  billed as STANDARD (over- or under-charge depending on the true type),
  with no flag in the stored breakdown to detect them afterwards.
- Pinned by: the `QUIRK: unknown case type ...` tests.
- Proposed fix (NOT applied): throw on unknown type, or add an explicit
  `fellBackToStandard` marker to the breakdown and alert upstream.

## 6. QUIRK — urgency is anchored to `now` (calculation time), not to the case

- Where: `const ref = now ? now : <wall clock>` and
  `daysBetween(ref, c.deadline) <= 7`.
- Reproducing input:
  - input `{ type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2021-05-18' }`
  - `calculateFee(input, '2021-05-10')` → total 13500 (8 days out: no urgency)
  - `calculateFee(input, '2021-05-16')` → total 15525 (2 days out: urgency)
  - `now` omitted → the real wall clock is used.
- Blast radius: the same stored case re-billed, re-audited or re-migrated on
  different days yields different fees; historical outputs are only
  reproducible if the exact `now` used at billing time is known. This is
  also why the suite injects `now` in every call.
- Pinned by: `QUIRK: urgency is measured against now (calculation time), not
  openedAt`.
- Proposed fix (NOT applied): anchor urgency to a documented, persisted
  reference (e.g. the case's `openedAt`, or the first-computation date
  stored next to the fee).

## 7. QUIRK — a past deadline still earns the urgency surcharge

- Where: `daysBetween(ref, c.deadline) <= 7` has no lower bound.
- Reproducing input:
  - `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2021-05-01', deadline: '2021-05-03' }, '2021-05-10')`
    → `daysBetween = -7`; `-7 <= 7` → `urgencyFee: 2025`, `total: 15525`.
- Blast radius: overdue cases keep earning the urgency percentage on every
  recomputation, indefinitely.
- Pinned by: `QUIRK: a PAST deadline (7 days before now) still earns the
  urgency surcharge`.
- Proposed fix (NOT applied): require `0 <= days <= 7`.

## 8. QUIRK — stepwise `Math.round` (half-up); expedited compounds on the rounded urgency

- Where: `pctOf()` rounds at each step ("rounded at each step since 2019;
  billing reconciles against these"); the expedited percentage is applied to
  `bandFee + urgencyFee`, i.e. on the already-rounded urgency.
- Reproducing input:
  - 2019 schedule, STANDARD band 2, urgent + expedited:
    urgency `18500 * 15% = 2775` (exact); expedited
    `(18500 + 2775) * 10% = 2127.5 -> 2128` (half rounds up);
    `total: 23403`.
  - Down-rounding: 2022 STANDARD band 4 → `6938.4 -> 6938`;
    2022 COMMERCIAL band 1 → `3752.4 -> 3752`.
  - Up-rounding: 2022 COMMERCIAL band 3 → `7575.6 -> 7576`;
    2022 COMMERCIAL band 4 → `11398.8 -> 11399`.
- Note: on the current tables the first step (urgency) never actually
  rounds — every band fee is a multiple of 100 and both urgency percentages
  are integers — so today only the expedited step can lose a fraction of a
  cent. A "cleanup" that rounds only the final total, or that stops
  compounding on the rounded urgency, would silently shift many stored
  fees (the 2127.5 case above is one of them).
- Pinned by: the `rounding: ...` describe block, including the sweep that
  proves the urgency step is exact on all 48 band fees.
- Proposed fix (NOT applied): treat stepwise rounding as the contract. If
  billing ever wants to change it, do a full historical reconciliation
  first; until then, keep the per-step `Math.round`.
