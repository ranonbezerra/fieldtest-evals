# NOTES — payment-status mapping extraction

## The three copies

Before this change, provider status → internal status was mapped in three
places:

1. **orders** — `src/orders/orders.status.ts`. The base mapping, for the
   order detail screen.
2. **payouts** — `src/payouts/payouts.status.ts`. The same mapping plus two
   payout-specific provider codes: `PAYOUT_SETTLED`, `PAYOUT_REVERSED`.
3. **reporting** — `scripts/reporting.ts`. The base mapping, except the
   failed bucket (`DECLINED`, `EXPIRED`) came back as upper-cased `'FAILED'`
   instead of `'failed'`.

All three now delegate to `PaymentStatusMapper` in
`src/shared/payment-status-mapper.ts`, which covers the union of provider
codes. The per-code mapping now exists in exactly one place.

`test/reporting.spec.ts` holds the characterization tests for the reporting
copy. They were written against the pre-extraction copy, before anything was
moved, to pin its output for every status it knew (including the quirk and
the silent skip).

## The reporting quirk (preserved)

The finance team's spreadsheets have filtered on the upper-cased `'FAILED'`
in the CSV status column since 2021. The casing is the file format, not a
bug. It is preserved by the `legacyReportCasing: true` option on
`PaymentStatusMapper`, which only the reporting call site
(`scripts/reporting.ts`) passes. It is not the default and was not
normalised away.

## Unknown provider codes — the divergence is deliberate

The three copies disagreed on unknown codes, and the extraction preserved
each behaviour through the mapper's `onUnknown` option:

| call site | `onUnknown` | behaviour |
|---|---|---|
| orders | `'throw'` | throws `unknown provider status: <code>` |
| payouts | `'unknown'` | returns the `'unknown'` sentinel, booked as unresolved |
| reporting | `'skip'` | returns `null`; `buildRows` drops the row |

**This divergence is deliberate; do not unify it.** Before anyone unifies
it, these have to be checked: the orders API's error surface (can it start
swallowing unknown codes instead of failing loudly?), the payout
reconciliation's guarantee that it never stops mid-run when the provider
emits a new code, and the finance CSV's row-count expectations (its
consumers may count rows, so a skip becoming a throw or a sentinel would
change the file). Each policy is a contract with a different caller.

## Consequence of the union mapping (instructed)

Because the mapper covers the union of provider codes, `PAYOUT_SETTLED` →
`'paid'` and `PAYOUT_REVERSED` → `'refunded'` are now known to all three
call sites, not only to payouts: orders no longer throws on those two
codes, and the report no longer skips them. This is the instructed union,
not part of the unknown-code divergence above — codes outside the union
still follow each call site's own policy (throw / `'unknown'` / skip).
