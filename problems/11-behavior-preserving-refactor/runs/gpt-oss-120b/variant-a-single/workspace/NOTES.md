# Divergent behaviours of `mapProviderStatus`

The three call‑sites (orders, payouts, reporting) historically implemented
their own copy of the provider‑status → internal‑status mapper.  When extracting
the shared implementation we deliberately **did not unify** the behaviours:

| Call‑site | Desired behaviour on unknown provider code | Legacy quirk |
|-----------|--------------------------------------------|--------------|
| **Orders** | Throw an exception (`Error: unknown provider status: …`). | – |
| **Payouts** | Return the literal string `'unknown'` (so the reconciliation flow can
collect unresolved IDs). | – |
| **Reporting** | Return `null` (so `buildRows` skips the entry). | Additionally, the statuses `'DECLINED'` and `'EXPIRED'` must be
mapped to upper‑cased `'FAILED'` to preserve the historic CSV format. |

These differences are encoded via `MapperOptions` passed to
`src/shared/payment-status-mapper.ts`:

- `unknownAsUnknown: true` → payouts.
- `unknownAsNull: true` → reporting.
- `legacyReportCasing: true` → reporting (upper‑casing the failed status).

All existing tests for orders and payouts continue to pass unchanged, and
characterisation tests for the reporting script pin the current output,
including the legacy casing quirk.
