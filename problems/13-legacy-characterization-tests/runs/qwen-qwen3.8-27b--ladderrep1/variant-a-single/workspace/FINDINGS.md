# FINDINGS — characterization of `feeCalculator.ts`

**Suite:** `test/fee-calculator.spec.ts` · **Subject:** `feeCalculator.ts` (in production since 2019, previously untested)
**Production file:** byte-identical to before this change. **No fix below is applied.**

The suite pins *what the code does today*. Tests named `pins F<n> ...` assert the current
output of a behaviour that is surprising or believed wrong and cross-reference the entry
here, so a reader scanning the suite knows it is pinned deliberately, not because it is
right. Every expectation in the suite is a frozen literal (hand-transcribed from the
production rate tables, percentages hand-computed, then verified against a local run of
the module) — none are derived from the code under test. Full `FeeBreakdown` objects are
asserted (all five fields), so shape changes also break the suite.

Determinism: every date in the suite is a literal; the clock is only ever injected via the
module's existing optional `now` parameter; the real-clock default branch is never
exercised (OQ-3). No randomness; no dependence on the machine's timezone.

## F1 — suspected bug: the 2022 rate-table boundary is exclusive, so cases opened exactly on 2022-07-01 are billed on 2021 rates

- **Repro:** `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2023-03-01')` → `{ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }`. One day later, `openedAt: '2022-07-02'` → `{ table: '2022', bandFee: 15000, ... }`.
- **What the code does:** `tableFor()` tests the 2021 edge with `openedAt >= REVISION_2021` (inclusive) but the 2022 edge with `openedAt > REVISION_2022` (exclusive).
- **What it probably intended:** both revisions to apply to cases opened *on* the revision date — the 2021 edge does, and the header comment says "2022-07: rate revision (see RATE_TABLE_2022)." Cannot be confirmed from the code alone (OQ-1).
- **Blast radius:** every case opened on 2022-07-01 has its base fee — and the urgency/expedite fees derived from it — stored on 2021 rates. The per-cell difference from the 2022 table ranges from 1500¢ (STANDARD band 1: 15000 − 13500) to 10000¢ (APPEAL band 4: 109000 − 99000). These values are already in the audited historical record, so a fix is a restatement decision for billing, not just a code change.
- **Proposed fix (not applied):** after billing confirms intent, change `openedAt > REVISION_2022` to `openedAt >= REVISION_2022`, and reconcile/restate the stored fees for cases opened on 2022-07-01.
- **Pinned by:** `pins F1 as-is (suspected bug): opened exactly 2022-07-01 ...` in the rate-table date boundaries block.

## F2 — table selection compares date *strings*; the 2022 edge flips based on string format

- **Repro:** `openedAt: '2022-07-01'` → 2021 table (STANDARD band 1: 13500). The same instant written as `openedAt: '2022-07-01T00:00:00.000Z'` → 2022 table (15000).
- **What the code does:** `tableFor()` compares the raw string. A datetime string sorts after its date-only prefix, so under the exclusive `>` edge the two formats fall on opposite sides of 2022-07-01. The 2021 edge (`>=`) is inclusive under both formats, so only the 2022 edge is affected.
- **Blast radius:** any importer, migration, or future writer that emits `openedAt` as a datetime instead of a date silently flips the rate table for boundary-day cases.
- **Proposed fix (not applied):** normalize before comparing, e.g. `const day = openedAt.slice(0, 10)` (or parse to a canonical date), and use `day` in `tableFor`.
- **Pinned by:** `pins F2: date-only 2022-07-01 and the same instant written as a UTC datetime ...`.

## F3 — overdue deadlines still trigger the urgent tier

- **Repro:** `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: '2023-02-26' }, '2023-03-01')` → `urgencyFee: 2025`, even though the deadline is 3 days *before* `now`.
- **What the code does:** urgency is `daysBetween(now, deadline) <= 7` — no lower bound, so negative day counts qualify.
- **What it probably intended:** urgency for deadlines within the next 7 days (`0 <= days <= 7`). Not confirmable from the code (OQ-2).
- **Blast radius:** overdue cases silently carry the 15–18% urgency surcharge in stored fees; overstates them if the tier was meant to be forward-looking only.
- **Proposed fix (not applied):** `const d = daysBetween(ref, deadline); if (d >= 0 && d <= 7) ...`, once intent is confirmed.
- **Pinned by:** `pins F3 as-is (surprising): a deadline 3 days in the past is still urgent ...`.

## F4 — the expedited fee compounds on (base + urgency), not on base alone

- **Repro:** 2021 table, STANDARD band 1, urgent + expedited → `expeditedFee: 1863` = 12% of (13500 + 2025). Had it been applied to the base alone it would be 1620.
- **What the code does:** `expeditedFee = pctOf(bandFee + urgencyFee, table.expeditedPct)` — the percentage is applied to the already-surcharged subtotal.
- **Blast radius:** every expedited *and* urgent case pays the expedited percentage on the urgency surcharge as well. All such stored fees.
- **Proposed fix (not applied):** if billing confirms the expedited fee should apply to the base only: `pctOf(bandFee, table.expeditedPct)`.
- **Pinned by:** the two `pins F4 ...` tests, plus all 48 cells of the fully-loaded matrix (both flags set).

## F5 — fractional complexity inside (1, 4) yields `bandFee: undefined` and `total: NaN`

- **Repro:** `calculateFee({ type: 'STANDARD', complexity: 1.5, openedAt: '2021-06-15' }, '2023-03-01')` → `{ table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }`. With a deadline in the window, `urgencyFee` is `NaN` as well.
- **What the code does:** the clamp only handles `!band || band < 1` (→ band 1) and `band > 4` (→ band 4). 1.5 passes both checks, so `bands[1.5 - 1]` is `undefined`, and the undefined/NaN then propagates through `pctOf` and into the total.
- **Blast radius:** `type`/`complexity` are "historically not validated upstream," so any fractional band in the wild would produce a NaN total — which typically serializes as `null` (or throws) downstream, silently breaking that case's billing. No evidence of occurrence; latent.
- **Proposed fix (not applied):** canonicalize the band, e.g. `band = Math.min(4, Math.max(1, Math.trunc(band)))`, or reject fractional/out-of-range values explicitly.
- **Pinned by:** the two `pins F5 as-is ...` tests in the degenerate-inputs block.

## F6 — unknown (or case-mismatched) case type silently falls back to STANDARD pricing

- **Repro:** `type: 'BANKRUPTCY'`, band 3, 2021 table → 29500 (the STANDARD band-3 fee); `type: 'standard'` → STANDARD; `type: ''` → STANDARD; `type: 'COMMERCIAL '` (trailing space) → STANDARD.
- **What the code does:** a miss on `table.base[c.type]` falls back to `table.base['STANDARD']`. The code comment calls this deliberate for "rare imports from the old system."
- **Blast radius:** typos in imported case types are billed as STANDARD — wrong in either direction — and the wrong number is what gets stored and audited.
- **Proposed fix (not applied):** validate `type` against the known set; keep the fallback only for an explicit allow-list of legacy-import values, and log a warning when it fires.
- **Pinned by:** the five `pins F6 ...` tests, including one showing the fallback follows the era's table (BANKRUPTCY on the 2022 table → 15000).

## F7 — per-step rounding: currently observable only at the expedited step; the urgency step's `Math.round` is a no-op for every fee in the current tables

- **What the code does:** `pctOf` rounds with `Math.round` (half-up for positive values). The urgency fee is rounded first; the expedited fee is then rounded on the already-rounded subtotal (base + urgencyFee); the total is the sum of the rounded parts with no final rounding. A single fully-loaded case can therefore be rounded twice.
- **Observation:** every band fee in all three tables is a multiple of 500, and 10/12/15/18% of a multiple of 500 is an integer (50/60/75/90), so the urgency step never actually rounds today. The expedited step sees (base + urgency), which can end in 5¢, so 10% can land exactly on .5. The affected cells today, all on the 2019 table:
  - STANDARD band 2: 10% of 21275 = 2127.5 → **2128** (half-up)
  - COMMERCIAL band 2: 10% of 36225 = 3622.5 → **3623**
  - ESTATE band 3: 10% of 45425 = 4542.5 → **4543**
  12% can never land exactly on .5 (12/100 reduces to 3/25), but it does produce ordinary fractions: 12% of 128620 = 15434.4 → 15434 (down), 12% of 63130 = 7575.6 → 7576 (up).
- **Blast radius / risk:** nothing in current outputs beyond the pinned cells, but any future rate revision that introduces a fee that is not a multiple of 500 will activate the currently-hidden rounding at the urgency step. The suite pins the direction (half-up) so such a change cannot land silently.
- **Pinned by:** the four `pins F7 ...` tests and all 48 cells of the fully-loaded matrix.

## Open questions (gaps deliberately not asserted)

- **OQ-1** Is the exclusive 2022 edge (F1) a bug or intentional? The two edges use different operators; the header comment and the 2021 precedent suggest inclusive, but intent cannot be determined from the code alone. Billing to confirm before any fix.
- **OQ-2** Should overdue deadlines be urgent (F3)? There is no spec in the code; "added after the Silva case" is the only hint.
- **OQ-3** The default branch of `now` (real clock: `new Date().toISOString().slice(0, 10)`, a UTC date) is never exercised: asserting on it would make the suite date-dependent. That the parameter is honoured when provided is pinned.
- **OQ-4** Non-ISO / invalid `openedAt` (e.g. `'2022-13-45'`): `tableFor` would still string-compare it, while `daysBetween` would produce `NaN` and silently disable urgency. Parsing of non-ISO strings is engine-dependent, so this is listed as a gap rather than asserted.
- **OQ-5** `deadline: ''` is falsy and disables urgency (pinned as a behaviour); whether upstream ever sends an empty deadline is unknown.
