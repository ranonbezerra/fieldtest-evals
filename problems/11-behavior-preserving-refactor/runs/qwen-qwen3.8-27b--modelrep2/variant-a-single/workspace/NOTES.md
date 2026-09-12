# NOTES — payment status mapper extraction

## What moved

The provider-status → internal-status table existed in three copies. It now
lives in one class, `PaymentStatusMapper` (`src/shared/payment-status.mapper.ts`),
and the three call sites delegate to it:

| Call site | Module | Config passed to the mapper |
| --- | --- | --- |
| Orders (order detail screen) | `src/orders/orders.status.ts` | `unknownCodePolicy: 'throw'`, `recognizedCodes: CORE_PROVIDER_CODES` |
| Payouts (reconciliation) | `src/payouts/payouts.status.ts` | `unknownCodePolicy: 'markUnknown'`, `recognizedCodes: ALL_PROVIDER_CODES` |
| Nightly CSV | `scripts/reporting.ts` | `unknownCodePolicy: 'skip'`, `recognizedCodes: CORE_PROVIDER_CODES`, `legacyReportCasing: true` |

`src/orders/orders.service.ts`, `src/payouts/payouts.service.ts`, and every
exported signature (`mapProviderStatus`, `buildRows`, `ReportRow`,
`OrderStatus`, `PayoutStatus`) are unchanged, so the pre-existing tests run
unmodified.

## The reporting quirk: `legacyReportCasing`

The nightly CSV has reported `DECLINED`/`EXPIRED` as upper-cased `FAILED`
while every other status is lower-case. Finance's spreadsheet has filtered on
exactly that value since 2021. The extraction preserves the quirk behind an
explicit mapper option:

```ts
new PaymentStatusMapper({ legacyReportCasing: true, /* ... */ });
```

Only `scripts/reporting.ts` opts in. **Do not** remove the option or "fix"
the casing — that would silently change a column finance consumes. If the
column ever becomes lower-case, change the spreadsheet first, then flip the
option.

## Unknown provider codes: the divergence is intentional (do not unify)

Each copy used to do a different thing with a code it did not know, and each
behavior is load-bearing. The mapper preserves them via `unknownCodePolicy`:

| Call site | Behavior (before and after) | Why |
| --- | --- | --- |
| Orders | Throws `Error('unknown provider status: <code>')` | A bad code on the order detail screen is a data error; fail loudly. |
| Payouts | Returns `'unknown'`; the record lands in `unresolved` | A reconciliation run must not stop on a code we have not seen yet. |
| Reporting | Returns `null`; `buildRows` omits the row | The CSV must not gain rows for statuses the report has never contained. |

## Which codes each call site recognizes

The mapper's table covers the **union** of provider codes: the base ten plus
`PAYOUT_SETTLED` / `PAYOUT_REVERSED`, which only the payout integration
receives. `recognizedCodes` keeps every call site restricted to the codes it
actually received before the extraction, so its behavior is unchanged for
every input:

- **orders** — `CORE_PROVIDER_CODES`: the two payout-only codes still
  **throw**, exactly as they did before.
- **payouts** — `ALL_PROVIDER_CODES`: the only call site that recognizes the
  payout-only codes.
- **reporting** — `CORE_PROVIDER_CODES`: the two payout-only codes are still
  **skipped** from the CSV, exactly as they were before.

Consequence: a `PAYOUT_SETTLED` or `PAYOUT_REVERSED` payment still never
appears in the nightly CSV. If the finance report should ever include
payout-only codes, make that decision explicitly — it is deliberately not a
side effect of this refactor.

## Characterization tests

`test/reporting.spec.ts` pins the reporting copy's output for every provider
status **before** any code moved: all ten known mappings (including the
`FAILED` casing quirk), `null` for unknown codes, and the row-level skip
behavior in `buildRows`. `test/orders.status.spec.ts` and
`test/payouts.status.spec.ts` run unmodified.
