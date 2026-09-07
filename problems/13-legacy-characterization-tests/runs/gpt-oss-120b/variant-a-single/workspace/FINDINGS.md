# Findings – feeCalculator.ts (characterization)

## 1. Table‑revision boundary bug
- **Observed behavior**: A case opened on `2022-07-01` uses the **2021** rate table.
- **Reproducing input**:
  ```ts
  calculateFee({
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2022-07-01',
  });
  // → result.table === '2021'
  ```
- **Likely intention**: The 2022 revision should become effective *on* `2022-07-01`. The code uses `if (openedAt > REVISION_2022)` rather than `>=`, so the first day of the new rate is still mapped to the old table.
- **Potential blast radius**: All cases opened on the exact day of a revision (here only `2022-07-01`) are billed with the previous year's rates. Historical fee audits may show mismatches for those cases.
- **Proposed fix** (not applied): Change the condition to `if (openedAt >= REVISION_2022)`.

## 2. Urgency calculation rounding
- **Observed behavior**: Urgency fee is computed with `Math.round((bandFee * urgencyPct) / 100)`. This rounds half‑up (e.g., 13500 × 15 % = 2025 → 2025). No bug, but the rounding strategy is a quirk that can produce a 1‑cent difference compared to floor/truncate.
- **Impact**: Billing reconciliation relies on this rounding; changing it would break historic totals.

## 3. Expedited fee includes urgency fee
- **Observed behavior**: When `expedited` is true, the expedited fee is calculated on `bandFee + urgencyFee`. This is intentional (as per current business rule) but could be surprising because some systems apply expedited percentage only to the base fee.
- **Reproducing input**:
  ```ts
  calculateFee({
    type: 'STANDARD',
    complexity: 2,
    openedAt: '2021-01-01',
    deadline: '2021-01-07', // triggers urgency
    expedited: true,
    now: '2021-01-01',
  });
  // expeditedFee = round((bandFee + urgencyFee) * 12%)
  ```
- **Potential blast radius**: Any change to this formula would affect all expedited cases, altering total fees by up to a few percent.

## 4. Unknown case type defaults to STANDARD
- **Observed behavior**: If `c.type` is not found in the rate table, the code falls back to the `STANDARD` rates.
- **Reproducing input**:
  ```ts
  calculateFee({ type: 'FOOBAR', complexity: 2, openedAt: '2020-01-01' });
  // → bandFee == STANDARD band 2 fee
  ```
- **Impact**: Historical data may contain legacy types; the fallback keeps billing functional but could hide classification errors.

## 5. Complexity handling edge cases
- **Observed behavior**:
  - `null` or `undefined` complexity throws `"complexity is required"`.
  - `complexity <= 0` is coerced to band 1.
  - `complexity > 4` is coerced to band 4.
- **Impact**: Guarantees a fee is always produced, but input validation upstream might be lax. Errors surface as exceptions, which could crash callers if not caught.

## 6. Days‑between calculation uses UTC date arithmetic
- **Observed behavior**: `daysBetween` creates `Date` objects from ISO strings (interpreted as UTC) and floors the millisecond difference divided by 86 400 000. This correctly counts whole days but ignores daylight‑saving edge cases (which do not affect UTC). No immediate bug, but the implementation assumes ISO strings without time components.

---

**Summary**: The current implementation is fully characterized by the test suite. The most critical bug is the off‑by‑one day in the 2022 revision boundary (2022‑07‑01). All other behaviors are quirks intentionally preserved for backward‑compatible billing. Any future modification should first update the tests to reflect the intended new behavior and then adjust the production code accordingly.
