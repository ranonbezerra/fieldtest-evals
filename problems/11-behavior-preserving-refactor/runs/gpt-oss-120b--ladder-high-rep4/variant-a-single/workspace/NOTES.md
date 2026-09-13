# Payment status mapping notes

This repository contains three historically separate mappings from provider
status codes to internal statuses:

- **Orders module** (`src/orders/orders.status.ts`): maps known provider codes
  to an `OrderStatus` and throws an error for unknown codes.
- **Payouts module** (`src/payouts/payouts.status.ts`): maps known provider
  codes (including two payout‑specific codes) to a `PayoutStatus`. For unknown
  codes it returns `'unknown'` so the reconciliation process can continue.
- **Reporting script** (`scripts/reporting.ts`): maps known provider codes to a
  string used in CSV reports. Unknown codes result in `null` (the row is
  skipped). It also has a legacy quirk: for the `DECLINED` and `EXPIRED`
  provider codes the status string is upper‑cased to `'FAILED'` to keep
  backward compatibility with existing finance spreadsheets.

The three behaviours have been deliberately preserved:

- **Throw on unknown** – required by the orders UI to surface integration
  problems.
- **Return `'unknown'`** – required by payout reconciliation to keep processing
  other records.
- **Return `null` (skip row)** – required by the nightly reporting script to
  omit unsupported rows.

These divergences are documented here and are implemented via the
`PaymentStatusMapper` API:

- `mapToOrderStatus` throws on unknown.
- `mapToPayoutStatus` returns `'unknown'` on unknown.
- `mapToReportStatus` returns `null` on unknown and supports the
  `legacyReportCasing` option to produce the `'FAILED'` upper‑cased value.

**Do not unify these behaviours** without a coordinated change to the UI,
reconciliation logic, and finance CSV consumers. Any unification would be a
breaking change for at least one consumer.
