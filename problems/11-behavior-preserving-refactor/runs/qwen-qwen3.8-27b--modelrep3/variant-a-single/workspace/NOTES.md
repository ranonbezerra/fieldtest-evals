# NOTES — PaymentStatusMapper extraction

## What changed

The provider-status → internal-status switch previously existed in three
independent copies:

| copy | file |
| --- | --- |
| orders (order detail screen) | `src/orders/orders.status.ts` |
| payouts (reconciliation) | `src/payouts/payouts.status.ts` |
| reporting (nightly finance CSV) | `scripts/reporting.ts` |

All three now delegate to one mapper, `PaymentStatusMapper` in
`src/shared/payment-status-mapper.ts`, which owns the provider-code table.
The module functions the existing code and tests import
(`mapProviderStatus` in the orders module, the payouts module and
`reporting.ts`) keep their names, signatures and exact behavior.

## The provider-code table is the union

The shared table contains every code any consumer can receive, including the
two payout-only codes `PAYOUT_SETTLED` and `PAYOUT_REVERSED` (→ `paid`,
`refunded`). Consequence: the orders and reporting wrappers now recognize
those two codes, where before they would have thrown / returned `null`. In
practice only the payouts integration ever sends them, so this is inert —
but it is the intended result of a single union table.

## Divergences that were deliberately NOT unified

### Unknown provider codes

Each copy behaved differently on an unknown code, and each keeps doing so,
selected via the mapper's `onUnknown` option:

| call site | old behavior | mapper config |
| --- | --- | --- |
| orders | `throw new Error('unknown provider status: <code>')` | `{ onUnknown: 'throw' }` |
| payouts | returns `'unknown'` so the reconciliation loop keeps running | `{ onUnknown: 'unknown' }` |
| reporting | returns `null`; `buildRows` silently skips the row | `{ onUnknown: 'null' }` |

Do not unify these. Orders is expected to fail loudly on a bad feed,
reconciliation must not stop mid-run, and the CSV has always omitted rows it
cannot classify.

### Reporting casing quirk

The reporting copy emitted the failure statuses upper-cased: `DECLINED` and
`EXPIRED` became `FAILED`, not `failed`. Finance's spreadsheet filters on the
upper-cased value in the status column (the column has been consumed since
2021). The mapper preserves this behind the explicit `legacyReportCasing:
true` option, which only the reporting call site sets. Do not remove it.

## Tests

- `test/reporting.spec.ts` (new) — characterization tests written against the
  reporting copy before moving any code. They pin its output for every
  provider code, including the `FAILED` quirk and the skip-on-unknown
  behavior in `buildRows`.
- `test/orders.status.spec.ts`, `test/payouts.status.spec.ts` — pre-existing,
  unmodified, still passing.
