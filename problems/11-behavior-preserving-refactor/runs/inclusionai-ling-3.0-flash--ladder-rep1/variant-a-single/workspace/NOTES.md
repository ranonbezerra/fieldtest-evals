# Payment Status Mapping — Divergence Notes

## Three call sites

The provider-status → internal-status mapping lives in one shared place:
`src/shared/payment-status-mapper.ts`. All three call sites delegate to it:

- `src/orders/orders.status.ts` — for order display
- `src/payouts/payouts.status.ts` — for payout reconciliation
- `scripts/reporting.ts` — for the nightly CSV

## The reporting quirk

The reporting call site passes `{ legacyReportCasing: true }`, which causes
`DECLINED` and `EXPIRED` to map to `'FAILED'` (uppercase) instead of `'failed'`.
The CSV consumers' spreadsheets filter on the upper-cased value and depend on
this. Do not remove the option without coordinating with finance.

## Deliberate divergence on unknown codes

Each call site handles unknown provider codes differently:

| Call site   | Behaviour                                  |
|-------------|--------------------------------------------|
| orders      | throws `Error` (`onUnknown: 'throw'`)      |
| payouts     | returns `'unknown'` (`onUnknown: 'unknown'`) |
| reporting   | returns `null` (`onUnknown: 'null'`)        |

These are three different contracts with three different callers. Before unifying:
1. Confirm all consumers of each behaviour are identified (orders UI, payouts
   reconciliation loop, reporting CSV pipeline).
2. Agree on a unified contract and update all three callers together.
3. Add tests for the new behaviour before removing the per-caller option.
