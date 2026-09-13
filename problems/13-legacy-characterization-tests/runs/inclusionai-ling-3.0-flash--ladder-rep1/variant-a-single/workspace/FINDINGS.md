# Findings — feeCalculator.ts characterization

Legacy fee-calculation module (in production since 2019, zero tests until this
characterization suite). All findings below describe **what the code currently
does**; proposed fixes are **not applied** (per issue #611).

---

## Finding 1 — `tableFor` boundary at REVISION_2022 is exclusive

- **Reproducing input:** `openedAt = '2022-07-01'` (exactly on the 2022 rate
  revision date).
- **What code does:** Returns `RATE_TABLE_2021` (bandFee for STANDARD band 1 =
  13 500). Cases opened on this date are charged at the 2021 rate.
- **Likely intent:** A case opened *on* a revision date should probably use the
  *new* rate table (`RATE_TABLE_2022`, bandFee = 15 000 for STANDARD band 1).
  The condition `openedAt > REVISION_2022` (strict-greater-than) excludes the
  boundary date itself.
- **Blast radius:** Any case opened exactly on 2022-07-01 that was generated
  after the revision took effect has a stored fee using the *old* rate table.
  Since billing feeds the annual audit, all such historical fees may be
  systematically understated/overstated depending on which table was correct.
- **Proposed fix (NOT applied):** Change the comparison in `tableFor` from
  `openedAt > REVISION_2022` to `openedAt >= REVISION_2022` so the boundary
  date selects the newer table. Validate against billing records before
  deploying.

---

## Finding 2 — `daysBetween(ref, deadline)` with overdue deadlines triggers urgency

- **Reproducing input:** `deadline = '2024-06-14'`, `ref (now) = '2024-06-15'`
  (deadline is 1 day *before* the reference date).
- **What code does:** `daysBetween` computes `deadline - ref = -1`. Since
  `-1 <= 7`, urgency fee is applied as if the case were urgent.
- **Likely intent:** The `<= 7` check was probably designed to detect cases
  due *within* 7 days (deadline in the future). An overdue case (deadline in
  the past) may or may not be "urgent" — this depends on business rules that
  are not documented in the code.
- **Blast radius:** All historical cases with expired deadlines that were
  processed while `now` was still after the deadline carry urgency fees that
  may not reflect actual billing intent. Any retrospective audit of fees
  where `deadline < now` needs this behaviour called out.
- **Proposed fix (NOT applied):** Clarify with billing whether overdue cases
  should be urgent. If not, change the condition to require `daysBetween` to
  be *positive and* `<= 7` (or `>= 0 && <= 7`). Open question — see open
  question below.

---

## Finding 3 — Unknown case types silently fall back to STANDARD

- **Reproducing input:** `type = 'SOME_UNKNOWN_TYPE'` (any string not in
  `['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL']`).
- **What code does:** `table.base[c.type]` is `undefined`, so the code falls
  back to `table.base['STANDARD']` and computes the fee as if the case were
  STANDARD. No error, no warning, no log entry.
- **Likely intent:** The comment says "unrecognized types were rare imports
  from the old system" — this suggests the fallback was a deliberate
  migration-compat measure. Whether it is still appropriate for new cases
  that arrive with unknown types is unclear.
- **Blast radius:** Any case with an unrecognized type silently undercharged
  (or overcharged) at the STANDARD rate rather than whatever the correct
  rate should be. If the upstream validation (`type: string` in `CaseInput`)
  is meant to prevent this, the fallback masks data-quality issues.
- **Proposed fix (NOT applied):** If the upstream importer should be
  validating types, remove the fallback and let errors surface. Otherwise,
  document the fallback as intentional and add structured logging. This is
  an open question.

---

## Open questions (cannot determine safely from reading the code)

1. **Direction of "urgency":** The `<= 7` check on `daysBetween(ref,
   deadline)` treats both near-future and overdue deadlines as urgent.
   Finding 2 describes this; the intended semantics need confirmation
   from billing stakeholders before any fix.

2. **Purpose of the `now` parameter:** The function signature includes
   `now?: string` but also calls `new Date().toISOString()` when `now` is
   absent. The fallback to wall-clock time makes the function
   non-deterministic in production. Is `now` always injected at the call
   sites in the billing path, or is the real-clock path a legacy code path
   that should also use an injected clock?

3. **2021-01-01 boundary direction ( Finding 1 analogue):** The inclusive
   boundary at REVISION_2021 (`openedAt >= REVISION_2021`) is consistent
   with the exclusive boundary at REVISION_2022 (`openedAt >
   REVISION_2022`). Was this asymmetry intentional (e.g., 2021 rates took
   effect on 2021-01-01 but 2022 rates took effect *after* 2022-07-01)?
   If so, the code is correct; if not, it is a bug.
