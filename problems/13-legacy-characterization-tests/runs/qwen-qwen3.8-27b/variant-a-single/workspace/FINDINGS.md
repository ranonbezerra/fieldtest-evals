# FINDINGS — feeCalculator characterization cycle (2025)

**Module:** `src/fee-calculator/fee-calculator.ts` (case-management, running since 2019, zero prior tests).
**Why:** next month the team modifies this module. It is consumed by billing; every fee it has ever emitted is stored and feeds the annual audit, so any behavior drift is a silent rate change on the historical record.
**What shipped with this cycle:** `test/fee-calculator.spec.ts` — a characterization suite pinning the module's behavior EXACTLY AS IT IS (quirks, bugs and all; flagged tests carry `[BUG]`/`[QUIRK]`/`[HOLE]` in their names and cross-reference the findings below), and this document. **The production file is untouched.** The only injection point used by the suite is the module's existing optional `now` parameter; no dates, randomness or real clock reads occur anywhere in the suite.

---

## Current behavior, pinned

Fee = round( round( tableValue × baseAmount × complexityMultiplier ) × urgencyMultiplier ), whole dollars, `Math.round` at both steps.

- **Complexity multipliers** (shipping): low 1, medium 2.5, high 3, critical 4.
- **Urgency** (shipping): `days = floor((now − filedAt) / 86_400_000)`; `days <= 0 → 1.5` ("immediate"), `days <= 3 → 1.2` ("expedited"), else 1.0 ("standard"). Unparseable `filedAt`/`now` → 1.0, silently.
- **Rate tables** keyed off `openedAt` (`now` does NOT select tables):

| transition | comparison (shipped) | edge behavior (shipped) | runbook says |
|---|---|---|---|
| 2019 → 2021 table | `openedAt <= 2021-01-01T00:00Z` | **inclusive**: 2021-01-01 00:00:00 still bills 2019 rates for one minute-boundary sliver | exclusive |
| 2021 → 2024 table | `openedAt <= 2024-03-15T00:00Z` | **exclusive in effect**: 2024-03-15 all day still bills 2021 rates | the 2024 revision was effective 2024-03-15 09:00 local |

Shipped table values (whole dollars) — `test` pins all 18 rows per era exactly:

| era | criminal L/M/H/C | civil L/M/H/C | family L/M/H/C | probate L/M/H/C | traffic L/M/H/C | tenant L/M/H/C |
|---|---|---|---|---|---|---|
| 2019 | 90/105/130/180 | 60/105/127.5/160 | 50/62.5/80/110 | 80/112.5/150/**0** | 40/52.5/75/95 | 35/45/60/75 |
| 2021 | 100/**112.5**/150/210 | 67.5/112.5/142.5/180 | 50/62.5/80/110 | 80/112.5/150/**0** | 44/58.5/82.5/105 | 35/45/60/**37.5** |
| 2024 | 100/112.5/150/210 | 72/120/150/189 | 50/62.5/80/110 | **100**/120/165/**0** | 44/58.5/82.5/105 | **100**/50/66/83 |

**Bold = deviates from the 2021/2024 rate-runbook** (F3 and F4). All other cells match the runbook.

---

## Findings, worst-first

### F1 — urgency: a 1-second-over-24h gap silently downgrades same-day cases from 1.5× to 1.2× (`[BUG-1]`)

- **Repro (pinned):** `filedAt = 2022-03-01T11:00Z`, `now = filedAt + 24h + 1s` → `days = 1` → fee `120` (on the 100/1× probe case). `now = filedAt` exactly → `150`.
- **Likely cause:** `Math.floor` of an epoch-millisecond delta is wall-clock, not calendar. The runbook tier "immediate = same filing *date*" requires *calendar* comparison.
- **Blast radius:** every case filed and "now"-ed across a midnight boundary — in practice most fees, because billing runs after filing. Roughly a 20% fee gap (1.5→1.2) on the largest tier. Stored history: two years of audit rows are systematically low; the annual fee audit has been comparing against runbook-derived expectations and absorbing this as "rounding noise".
- **Fix proposed (NOT applied):** compute `days` from calendar dates (`UTC` date parts of `filedAt` and the clock), or compare *date-instant* of `filedAt` vs *date-instant* of `now`; keep `days < 0 → 1.5` behavior under F6 until re-confirmed. Then re-pin this block and replay stored fees.

### F2 — double rounding: the step-2 `Math.round` and step-3 `Math.round` can move the final fee by ±1 vs a single final round (`[QUIRK-2]`)

- **Repro (pinned):** baseAmount 21, civil/low (67.5), 1.2× → step2 `round(67.5)=68`, step3 `round(81.6)=82`. Single-final-round intent: `round(67.5×1.2)=round(81.0)=81`. Also pinned: negative tie `-12.5 → -12` (Math.round is toward +∞, not toward zero, not banker's).
- **Blast radius:** any fee whose complexity product is a `.5` fraction AND urgency > 1: 1-unit over/undercharge. Small per fee, but the audit recomputes fees with a SINGLE final round, so the module and the auditor disagree by $1 on exactly these rows — a standing, explainable reconciliation delta.
- **Fix proposed (NOT applied):** round once, at the end, with an explicit documented convention (recommend half-up in integer cents: `Math.round(x * 100) / 100` then integer). The two tie-direction pins (positive +1, negative −1-asymmetry) must be consciously re-pinned to the chosen convention.

### F3 — table drift from the runbook: 2021 criminal HIGH and 2021 tenant CRITICAL were botched; 2024 probate/low and tenant/low never updated (`[QUIRKY-VALUES]`, matrix block)

- **Repro (pinned, 24-cell matrix, 2021 era, standard):** criminal/high bills `338` (112.5×3 — the *medium* value was copied into *high*; runbook 150 → 450): a **25% undercharge** on criminal-high. tenant/critical bills `150` (37.5×4 — a botched halving; runbook 75 → 300): **50% undercharge** on tenant-critical. 2024: probate/low and tenant/low read `100` (2019 values); runbook says `88` and `38`: probate-low **14% overcharge**, tenant-low **164% overcharge**.
- **Likely cause:** the 2021 and 2024 revisions were hand-edited into the constant with no diff against the rate memo; the copy/paste and stale values were never caught because no test existed.
- **Blast radius:** *systematic* and *era-bounded* — every criminal-high and tenant-critical case opened in the 2021–2024 window, and every probate-low/tenant-low case opened from 2024-03-15 onward, bills the wrong rate forever, and the stored audit trail encodes it. This is the single most expensive finding.
- **Fix proposed (NOT applied):** restore runbook cells (150, 75, 88, 38), then a one-time, billing-approved backfill decision for the stored rows. Until then the suite pins the wrong values ON PURPOSE.

### F4 — inconsistent boundary semantics on the two date transitions (`[QUIRKY-Boundary]`)

- **Repro (pinned):** `2021-01-01T00:00:00Z` → 2019 table (inclusive edge; one minute later → 2021). `2024-03-15T00:00:00Z` **and** `T12:00:00Z` → 2021 table (the new era's own first day bills old rates; the 2024 table first applies 2024-03-16T00:00Z).
- **Likely cause:** the 2024 transition was added later with a `<=` that was meant to be `<` (or an era "effective" instant of 09:00 local was never encoded); the 2021 one was left as originally written. The two edges disagree with each other and with the runbook.
- **Blast radius:** cases opened on 2024-03-15 (a full day) billed at old rates; the 2021 edge is a one-minute sliver at midnight UTC — near-zero money, but the *inconsistency* is a trap for anyone extending the transition list.
- **Fix proposed (NOT applied):** explicit, named era bounds (`{ from, until, inclusive }`) with UTC *midnight* boundaries and a single helper; pick one convention for both edges; re-pin the boundary block. Note the local-time "09:00 effective" nuance — if billing ever relied on local-effectivity, this fix must reproduce it, not erase it.

### F5 — degenerate inputs pass straight through (`[HOLE-1..3]`)

Pinned behaviors, all unvalidated, all in the suite:

| input | shipped result | risk |
|---|---|---|
| `baseAmount: 0` | `fee: 0`, no flag | zero-fee cases are indistinguishable from errors downstream |
| `baseAmount: -105` | negative fee (a "credit"), `-281.25 → -281` | negative fees flow into billing; no guard anywhere |
| unknown `caseType` | `NaN` fee, **no throw** | NaN can poison an export row; the `?.` lookup is unguarded by design-gap |
| unknown `complexity` | `NaN` fee | same |
| unparseable `openedAt` | silently falls back to the 2019 table (`NaN <= x` is false → first table kept) | a typo in `openedAt` silently re-eras the fee to 2019 rates — a *soft* failure where the key lookups are *hard* (NaN); asymmetric and undocumented |
| unparseable `filedAt`/`now` | urgency silently 1.0× | a bad timestamp buys a 20% discount on same-day cases |

- **Blast radius:** depends on upstream validation, which does not exist in this module. Assume the case-records table has all of these: they have, in at least two support tickets.
- **Fix proposed (NOT applied):** validate at the boundary — throw a typed `FeeInputError` for non-finite/unknown/degenerate values; decide a *declared* policy for `baseAmount <= 0` (reject vs. explicit zero-fee sentinel in the result, e.g. `{ fee: 0, noFee: true }`). Re-pin the block with the chosen policies.

### F6 — quirks pinned without a clear intent (documented, not yet bug-or-feature)

1. **Negative day deltas bill 1.5×** (`[QUIRKY-Urgency]`): `now` before `filedAt` (back-dated records) hits `days <= 0` → the *premium* rate. Likely a coincidence of the same `floor` bug as F1; confirm with billing whether back-dated filings were ever meant to be standard.
2. **`probate/critical = 0` in every era** (`[QUIRKY-VALUE]`): the 2019 cell was never priced and the later revisions preserved the 0 verbatim. Either a genuine "no critical probate fees" policy (never written down) or a hole. Ask billing; pin stays 0 until then.
3. **Tier boundary at exactly 3 days is 1.2×**: runbook "1..3 days" matches; noted because an `inclusive`/`exclusive` cleanup (F1/F4) must not shift it.
4. **The `now` parameter is urgency-only and is *optional***: with `now` omitted the module reads the real clock — any caller not passing it (the original 2019 call sites) gets wall-clock urgency, i.e. F1-scale nondeterminism in production, invisible to this suite. Audit the call sites before the F1 fix.

---

## Determinism guarantee

Every assertion in the suite uses fixed ISO strings and fixed injected `now`s; `Math.round` tie-direction is pinned directly (including the negative-tie asymmetry). Re-running the suite on any host, any TZ, any date, must yield identical results. If it ever doesn't, the failure is information.

## Suggested order of the modification work (next month)

1. Merge this suite as-is; it is the red line.
2. Fix F3 (wrong cells) first — it is pure data, no logic change, smallest blast radius, largest money impact. Replay the stored-fee diff for the 2021+ and 2024+ windows; billing signs the backfill policy.
3. Fix F1 (calendar-day urgency) with a UTC-date comparison; F4 (named era bounds) in the same PR since both touch date math.
4. F2 (single final round, explicit convention) — expect a $1-delta replay on `.5`-fraction rows; publish the reconciliation.
5. F5/F6 after policies are written down with billing; each fix re-pins its flagged block, and the unflagged blocks must stay green untouched.

Until step 1 is merged, **do not touch `fee-calculator.ts`.**
