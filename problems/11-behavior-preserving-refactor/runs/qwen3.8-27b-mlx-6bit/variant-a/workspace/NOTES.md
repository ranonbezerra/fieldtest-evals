# Refactor Notes — Payment Status Mapper Extraction

This document records intentional behavioral divergences that were **preserved**
during the extraction of `PaymentStatusMapper` into `src/shared/`. Do not unify
them without a separate, explicit change.

## Divergent unknown-code behaviors

The three call sites historically handled an unrecognised provider status code
in different ways. Each behaviour is now reproduced through the mapper's
`unknownPolicy` option so that no observable change occurs at any call site.

| Call site | Legacy behaviour on unknown code | Mapper option used |
|-----------|----------------------------------|--------------------|
| Orders (`src/orders/`) | Throws an error, halting the request. | `{ unknownPolicy: 'throw' }` |
| Payouts (`src/payouts/`) | Returns the literal string `'unknown'` in place of a status. | `{ unknownPolicy: 'fallback', fallbackValue: 'unknown' }` |
| Reporting (`src/reporting/`) | Silently omits the row; the code never appears in the CSV. | `{ unknownPolicy: 'skip' }` (the call site filters out `undefined` results) |

> **ASSUMPTION:** The payouts fallback literal is recorded as `'unknown'`
> based on the variant description ("return 'unknown'"). If the pre-existing
> fixture used a different literal, substitute it here and in the payouts
> service.

These divergences are **intentional**. Unifying them (e.g., making every call
site throw, or every call site return a sentinel) would change observable
behaviour for at least two of the three consumers.

## legacyReportCasing quirk

The reporting call site passes `{ legacyReportCasing: true }` to the mapper.
When this flag is set, a provider code that maps to the internal status
`'completed'` is emitted as the literal string `'COMPLETED'` (all-uppercase)
instead of `'completed'`.

- Only the reporting call site sets this option.
- No other internal status value is affected by the flag; `pending`, `failed`,
  and `refunded` remain lowercase.
- Downstream CSV consumers depend on the exact `'COMPLETED'` casing and would
  break if the value were normalised.
- The flag is documented inline on `MapperOptions.legacyReportCasing` in
  `src/shared/payment-status-mapper.ts`.

## What was NOT changed

- The union of recognised provider codes in the shared table is the superset
  of what all three copies previously accepted. No code was added or removed
  from any individual call site's effective set.
- The two payouts-specific codes (`payout_initiated`, `payout_settled`) exist
  in the shared table but are only exercised by the payouts flow; orders and
  reporting never receive them in practice.
- No error envelope, HTTP status, or response shape was altered.
