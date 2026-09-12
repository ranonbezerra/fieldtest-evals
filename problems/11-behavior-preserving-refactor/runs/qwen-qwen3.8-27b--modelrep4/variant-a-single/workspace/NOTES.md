# NOTES — PaymentStatusMapper extraction

## What changed

The three hand-kept copies of the provider-status mapping now delegate to a
single `PaymentStatusMapper` in `src/shared/payment-status.mapper.ts`:

- `src/orders/orders.status.ts` — thin delegate, still throws on unknown codes.
- `src/payouts/payouts.status.ts` — thin delegate, still records unknown codes as `'unknown'`.
- `scripts/reporting.ts` — thin delegate, still silently skips unknown codes; constructed with `{ legacyReportCasing: true }`.

The mapper knows the **union** of provider codes, including the two
payout-only codes `PAYOUT_SETTLED` and `PAYOUT_REVERSED`.

## Unknown codes: the divergence is preserved, not unified

Before the extraction the three copies disagreed on what to do with a code
they did not know. That disagreement is intentional, predates this change,
and each call site depends on it. The mapper therefore reports "I do not
know this code" by returning `null` from `map()`, and each call site keeps
its own historical policy in its delegate:

| Call site | Unknown-code behavior | Why it exists |
|---|---|---|
| orders (`src/orders/orders.status.ts`) | throws `Error('unknown provider status: <code>')` | The order detail screen has no sensible fallback; surfacing the bug beats showing a wrong status. |
| payouts (`src/payouts/payouts.status.ts`) | returns `'unknown'`, listed in `Reconciliation.unresolved` | Reconciliation must not stop on a code we have not seen yet. |
| report (`scripts/reporting.ts`) | `mapProviderStatus` returns `null`; `buildRows` drops the row | The nightly CSV must keep running and keep its shape; unknown payments are omitted rather than failing the job. |

**Do not unify these three policies.** Unifying them (e.g. making the report
throw, or orders fall back to `'unknown'`) would change the runtime behavior
of the order screen, the reconciliation output, and the nightly CSV.

## The reporting casing quirk

`scripts/reporting.ts` used to emit the upper-cased string `'FAILED'` for
`DECLINED`/`EXPIRED` while the other two copies emit `'failed'`. Finance's
spreadsheets (in use since 2021) filter on that exact value, so the quirk is
preserved through the mapper's explicit option `{ legacyReportCasing: true }`.
The report is the **only** call site that enables it. The orders and payouts
mappers are constructed with no options and can only produce lowercase
statuses; their delegates additionally guard against the `'FAILED'` value
and fail or bucket loudly if it ever reaches them.

## One intentional consequence of the union

Before the extraction the report did not know `PAYOUT_SETTLED` /
`PAYOUT_REVERSED` and silently skipped such rows. After it, the shared mapper
knows the union, so those two codes now map (`paid` / `refunded`) in the
report as well, per the instruction to cover the union of provider codes.
Every code the report knew before maps exactly as before — pinned by the
characterization tests in `test/reporting.spec.ts`.

## Tests

- `test/reporting.spec.ts` — characterization tests for the reporting copy,
  written before the extraction. Pins its output for every status it handled
  (including the `'FAILED'` quirk) plus `buildRows`' skip-unknown and
  empty-input behavior.
- `test/orders.status.spec.ts`, `test/payouts.status.spec.ts` — pre-existing,
  unchanged, still passing through the thin delegates.
