# NOTES — payment-status mapping (issue #402)

## The three copies, and what each did

Before the extraction, provider status → internal status was mapped in three
places, and they had drifted:

| Call site | File (before) | Unknown provider codes | Extra codes | Casing quirk |
|---|---|---|---|---|
| orders | `src/orders/orders.status.ts` | threw | — | — |
| payouts | `src/payouts/payouts.status.ts` | returned `'unknown'` | `PAYOUT_SETTLED`, `PAYOUT_REVERSED` | — |
| reporting | `scripts/reporting.ts` | returned `null`; the row was skipped | — | `DECLINED`/`EXPIRED` → `FAILED` |

All three now delegate to a single `PaymentStatusMapper` in
`src/shared/payment-status.mapper.ts`. Its table is the **union** of the
provider codes across the three copies (12 codes, including the two
payout-only ones), so `grep` for the mapping's switch finds exactly one.

The per-module files keep their public `mapProviderStatus` so the existing
services and tests are untouched; the behaviour differences moved into
mapper options instead of duplicated `switch` bodies.

## The reporting quirk is a format, not a bug

The nightly CSV upper-cases the failed statuses: `DECLINED` and `EXPIRED`
come out as `FAILED`, not `failed`. The finance team's spreadsheets have
filtered on the upper-cased value in that column since 2021.

The quirk is preserved by the explicit option `{ legacyReportCasing: true }`,
passed **only** by the reporting call site. It is opt-in, not the default,
and it is not a branch hidden in the call site. The characterization tests in
`test/reporting.spec.ts` pin it for both codes and were written **before**
the extraction, against the original copy.

## The unknown-code divergence is deliberate

The three call sites still disagree about provider codes the mapping does
not know, and that disagreement is **deliberate** — it is preserved by the
`onUnknownCode` option:

- **orders** — `onUnknownCode: 'throw'`: the order detail screen fails
  loudly on data it cannot display.
- **payouts** — `onUnknownCode: 'unknown'`: reconciliation must not stop on
  a code nobody has seen yet; the record is bucketed as `unresolved`.
- **reporting** — `onUnknownCode: 'skip'`: the CSV simply does not contain
  that payment.

Unifying these three would be a behaviour change wearing a cleanup's
clothes. Before anyone unifies them, at minimum check:

1. every consumer of the order detail screen — who handles the thrown error
   today, and whether silently displaying an `'unknown'` order would hide a
   broken integration;
2. the reconciliation job and its alerting around the `unresolved` bucket —
   a throw would abort the whole run;
3. the finance spreadsheets — a dropped row and a sentinel value are not
   interchangeable in a filter.

## One consequence of taking the union

`PAYOUT_SETTLED` and `PAYOUT_REVERSED` used to be *unknown* to the orders
copy (it would have thrown) and to the reporting copy (it would have
skipped the row). Because the shared table covers the union, all three call
sites now map them to `paid` and `refunded`. In practice those codes only
arrive on the payouts side of the integration, so no order or report row is
expected to be affected. The reporting characterization tests therefore pin
the ten codes the report knows plus a sentinel unknown code, not the two
payout-only codes.
