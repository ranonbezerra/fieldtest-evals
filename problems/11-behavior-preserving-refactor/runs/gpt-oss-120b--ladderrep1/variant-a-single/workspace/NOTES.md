# Payment status mapping – divergence notes

Three parts of the codebase map provider status codes to internal status values.
The extraction to a single `PaymentStatusMapper` preserves the **behavioural
differences** that already existed.

## Call‑site behaviours

| Call‑site | Unknown code handling | Special handling |
|-----------|----------------------|------------------|
| **Orders** (`src/orders/orders.status.ts`) | **Throws** (`Error`) | No special casing |
| **Payouts** (`src/payouts/payouts.status.ts`) | Returns literal string **`'unknown'`** | No special casing |
| **Reporting script** (`scripts/reporting.ts`) | Returns **`null`** (row is skipped) | `failed` status is upper‑cased as **`'FAILED'`** (legacyReportCasing) |

These behaviours are **deliberate** and are encoded via the `MapperOptions`
passed to the shared mapper:

- `unknownBehavior: 'throw'` → orders
- `unknownBehavior: 'unknown'` → payouts
- `unknownBehavior: 'null'` & `legacyReportCasing: true` → reporting

## Why not unify?

Unifying the handling of unknown codes would change the contract of each
module:

* Orders would stop throwing, potentially hiding integration bugs.
* Payout reconciliation would lose the `"unknown"` bucket used for later
  investigation.
* Reporting would start emitting rows with an empty status, breaking downstream
  CSV consumers that rely on the row being omitted.

Any future change must first evaluate the impact on these three distinct
consumers.

## Legacy report casing

The reporting CSV has, since 2021, filtered on the upper‑cased `"FAILED"` value.
The mapper now exposes the option `legacyReportCasing` so the behaviour is
explicit and documented. The option is **only** used in the reporting script.

---  

*The mapper lives in `src/shared/payment-status-mapper.ts`. All three
call‑sites delegate to it, and the `grep` for the old `switch` statements now
finds only this single implementation.*
