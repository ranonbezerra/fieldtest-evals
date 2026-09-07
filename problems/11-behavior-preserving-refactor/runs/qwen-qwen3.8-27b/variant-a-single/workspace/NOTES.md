# NOTES -- PaymentStatusMapper extraction

## What was done

The provider-status -> internal-status mapping existed in three copies:

| # | Call site | File | Quirk |
|---|-----------|------|-------|
| 1 | orders module | `src/orders/orders.service.ts` | -- |
| 2 | payouts module | `src/payouts/payouts.service.ts` | two extra provider codes: `SETTLED`, `RECALLED` |
| 3 | reporting script | `scripts/generate-status-report.ts` | `REVERSED` emitted as uppercase `VOIDED` |

All three call sites now delegate to `src/shared/payment-status-mapper.ts`,
which covers the **union** of provider codes (base six + `SETTLED` + `RECALLED`).
The mapper is a plain class, not a NestJS provider, because the preserved
behaviors differ per call site and each call site constructs its own instance.

## Unknown provider codes -- divergence preserved, NOT unified

Each call site keeps the behavior its copy had before the extraction, selected
through the mapper's `onUnknown` option:

| Call site | Option | Behavior on an unknown code |
|-----------|--------|------------------------------|
| orders | `onUnknown: 'throw'` | throws, surfaced as envelope code `unrecognized_provider_status` |
| payouts | `onUnknown: 'unknown'` | returns the `"unknown"` sentinel |
| reporting | `onUnknown: 'skip'` | mapper returns `null`; the script omits the row |

This divergence is intentional. Do NOT unify it without confirming all three
consumers tolerate a single behavior.

## Reporting casing quirk -- preserved, not fixed

The legacy reporting script emitted `VOIDED` (uppercase) for `REVERSED` while
the API surfaces `voided`. Downstream CSV consumers depend on the exact
uppercase token, so the mapper takes a `legacyReportCasing: true` option that
**only** the reporting call site sets. Orders and payouts leave it unset.

The quirk and the silent-skip behavior are pinned by characterization tests in
`test/reporting.spec.ts`, which were written before the extraction.

## One known consequence of union coverage

`SETTLED` and `RECALLED` were previously unknown to the orders and reporting
copies. Because the mapper covers the union of provider codes (per the
refactor instruction):

- orders now maps them to `settled` / `recalled` instead of throwing;
- reporting now includes such rows instead of skipping them.

Provider codes unknown to **all** copies (typos, new provider codes) still
behave exactly as before at each call site.

## Test status

- `test/reporting.spec.ts` -- new; pins the reporting copy's output for every
  status it knew (including the `VOIDED` quirk) plus the silent-skip behavior.
- `test/orders.spec.ts`, `test/payouts.spec.ts` -- pre-existing, partial;
  pass unmodified.
