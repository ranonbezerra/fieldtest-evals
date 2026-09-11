# NOTES — payment-status mapping (Issue #402)

## The three copies, before

Provider status → internal status was copy-pasted in three places, and the
copies had drifted:

1. **Orders** — `src/orders/orders.status.ts`. The base mapping, for the
   order detail screen. Unknown provider codes **threw**
   (`unknown provider status: <code>`).
2. **Payouts** — `src/payouts/payouts.status.ts`. The same base mapping
   plus two codes only the payouts side of the integration can receive
   (`PAYOUT_SETTLED` → `paid`, `PAYOUT_REVERSED` → `refunded`). Unknown
   codes returned the **`'unknown'`** sentinel so a reconciliation run
   never stopped.
3. **Reporting** — `scripts/reporting.ts`. The base mapping, except
   `DECLINED`/`EXPIRED` mapped to **`'FAILED'`** (upper-cased) instead of
   `'failed'`. Unknown codes returned `null` and `buildRows` **skipped**
   those rows silently.

All three now delegate to the single table in
`src/shared/payment-status.mapper.ts`; the per-module files keep their
public exports and their contracts.

## The reporting quirk is preserved, on purpose

The finance team's spreadsheets have filtered on the upper-cased `FAILED`
value in the nightly CSV's status column since 2021. It is not a bug to
fix; it is the format. It is now an explicit option on the mapper,
`legacyReportCasing: true`, passed **only** by the reporting call site. It
is not the default and it is not hidden in a branch: the mapper applies
the casing only when the option is on, and the option is documented at the
mapper and at the call site. Do not normalise it away — changing it
changes the CSV.

## Unknown-code divergence: deliberate, do not unify

The three call sites still disagree on codes the table does not know. That
divergence used to be accidental; after this refactor it is **deliberate**,
and it is expressed through the mapper's `onUnknown` option:

| Call site | Option value  | Behaviour                                          | Why the contract exists |
|-----------|---------------|----------------------------------------------------|--------------------------|
| orders    | `'throw'`     | throws `unknown provider status: <code>`           | the detail screen must not render a status nobody has verified |
| payouts   | `'unknown'`   | returns the `'unknown'` sentinel (row goes to `unresolved`) | a reconciliation must not crash on a new provider code |
| reporting | `'null'`      | returns `null`; the row is skipped from the CSV    | one exotic code must not block the whole finance export |

Before anyone unifies these policies: check what each caller does with the
failure mode (how does the orders API surface the throw? who consumes
payouts' `unresolved` list? can finance tolerate a row appearing in or
disappearing from the CSV?), and get finance to sign off on any CSV change.
Unifying is a behaviour change wearing a cleanup's clothes.

## Order of work

The characterization tests in `test/reporting.spec.ts` — for the copy that
had no tests and the behaviour the CSV depends on — were written **first**,
against the pre-move `scripts/reporting.ts`, pinning its exact output for
every status it knew (including the `FAILED` casing) and its silent-skip of
unknown codes. They were green before the extraction and pass unmodified
after it. All pre-existing tests pass unmodified.

## One instructed consequence of the union table

The shared mapper covers the **union** of provider codes, as the ticket
required. Consequence: the two payout-only codes (`PAYOUT_SETTLED`,
`PAYOUT_REVERSED`) are now known to the reporting copy and map to
`paid`/`refunded`, where the report previously skipped them. The nightly
feed has in practice only carried the base codes, so this should be
invisible — but if the reporting input could ever carry payout codes, check
with finance before shipping.
