# NOTES

## Shared PaymentStatusMapper

The provider-status → internal-status mapping previously existed in three
copies:

- `src/orders/orders.status.ts`
- `src/payouts/payouts.status.ts`
- `scripts/reporting.ts`

All three now delegate to a single `PaymentStatusMapper` in
`src/shared/payment-status.mapper.ts`, which covers the union of provider
codes known to any copy (including the payout-specific `PAYOUT_SETTLED` and
`PAYOUT_REVERSED`). The two per-site behaviours the triplication used to
encode are now explicit mapper options, and both divergences are
**intentional and were not unified**.

## Divergence 1 — unknown provider codes (`onUnknown`)

| Call site | Option value      | Behaviour for a code outside the union     |
| --------- | ----------------- | ------------------------------------------ |
| orders    | `'throw'`         | throws `unknown provider status: <code>`   |
| payouts   | `'returnUnknown'` | returns `'unknown'`; reconciliation buckets it |
| reporting | `'returnNull'`    | returns `null`; `buildRows` drops the row  |

These encode different product decisions (fail loudly on bad data / never
stop reconciliation / keep the CSV clean) and are pinned by existing
behaviour and tests. Unifying them is a product decision, not a refactor.

## Divergence 2 — legacy report casing (`legacyReportCasing`)

The nightly CSV's status column has carried **upper-cased `FAILED`** for
`DECLINED` and `EXPIRED` since 2021, and finance's spreadsheets filter on
that exact casing. The mapper emits lowercase `failed` by default and
`FAILED` only when constructed with `{ legacyReportCasing: true }` —
currently **only** the reporting call site (`scripts/reporting.ts`) sets
the option. `test/reporting.spec.ts` pins the casing. Do not change the
casing or enable the option elsewhere without coordinating with finance.

## Known consequence — payout codes now appear in the report

The reporting copy did not know `PAYOUT_SETTLED` or `PAYOUT_REVERSED` and
dropped those rows from the CSV. Because the shared mapper covers the union
of provider codes, those two codes now map to `paid` and `refunded` and
will appear in the report. This is the one intentional output change from
the extraction; it is pinned in `test/reporting.spec.ts` and should be
flagged to the finance team.

## Module façades

`src/orders/orders.status.ts` and `src/payouts/payouts.status.ts` remain as
thin façades exporting the same `mapProviderStatus` functions (and
`OrderStatus` / `PayoutStatus` types) that the existing tests and services
import from those paths; the mapping table itself lives only in the shared
mapper.
