# Payment Status Mapping — Notes

## Three call sites (now one source of truth)

The provider status → internal status mapping used to exist in three places:

- `src/orders/orders.status.ts` — for the order detail screen
- `src/payouts/payouts.status.ts` — for payout reconciliation
- `scripts/reporting.ts` — for the nightly CSV export

All three now delegate to `src/shared/payment-status-mapper.ts`.

## The reporting quirk

The reporting script returns `'FAILED'` (uppercase) for `DECLINED` and `EXPIRED`,
while the other two call sites return `'failed'` (lowercase). Finance CSV
consumers depend on this casing. The `{ legacyReportCasing: true }` option on
the mapper preserves it; only the reporting call site uses it.

## Deliberate divergence on unknown provider codes

Each call site handles an unrecognized provider code differently:

- **Orders** — throws (`throwOnUnknown: true`)
- **Payouts** — returns `'unknown'` (`resolveUnknown: true`)
- **Reporting** — returns `null` (default behaviour)

This divergence is intentional. Each caller has a different contract with its
downstream consumer. Before anyone unifies these:

1. All three downstream consumers must agree on a single contract.
2. The order detail screen, payout reconciliation, and finance CSV pipeline
   must all be updated in the same release.
3. A migration/backfill plan must exist for any data that was silently skipped,
   thrown on, or marked as `'unknown'`.
```
