# NOTES — payment-status mapping (issue #402)

## The three copies, before this change

Provider status → internal status was implemented in three places, each with
its own `switch`:

1. **`src/orders/orders.status.ts`** — the base mapping, for the order
   detail screen. Unknown provider code: **throws**
   (`unknown provider status: <code>`).
2. **`src/payouts/payouts.status.ts`** — the same mapping plus two codes
   only the payout integration receives (`PAYOUT_SETTLED`,
   `PAYOUT_REVERSED`). Unknown provider code: **returns `'unknown'`**, so
   reconciliation keeps going and the record lands in `unresolved`.
3. **`scripts/reporting.ts`** — the same mapping, for the nightly finance
   CSV. Unknown provider code: **returns `null`**, and `buildRows`
   **skips** the row.

The copies had also drifted: the reporting copy never learned the two
payout-only codes, and it upper-cases one status differently (below).

## The reporting quirk

`scripts/reporting.ts` emitted **`'FAILED'`** (upper case) for `DECLINED`
and `EXPIRED`, where orders and payouts emit `'failed'`. Finance's
spreadsheets have filtered on that exact value since 2021. The casing is
the CSV format now, not a bug.

After the extraction the quirk is an **explicit option** on the shared
mapper — `new PaymentStatusMapper({ legacyReportCasing: true })` — passed
by `scripts/reporting.ts` **only**. It is documented on the option in
`src/shared/payment-status-mapper.ts`, pinned by `test/reporting.spec.ts`,
and must not be normalised away, made the default, or left implicit in a
branch at the call site.

## The extraction

- `src/shared/payment-status-mapper.ts` holds the single provider-code
  table: the **union** of every code the three call sites can receive
  (the base ten plus `PAYOUT_SETTLED` / `PAYOUT_REVERSED`). `grep` for the
  mapping's `switch` now finds one.
- All three call sites delegate to the mapper; nothing else moved.
- `test/reporting.spec.ts` is a set of **characterization tests written
  before the move**, pinning the reporting copy's current output for every
  status, including the quirk. It is the safety net that copy had never
  had.
- The pre-existing `test/orders.status.spec.ts` and
  `test/payouts.status.spec.ts` pass unmodified.

## Unknown provider codes: the divergence is deliberate

Orders **throws**, payouts **returns `'unknown'`**, the report **skips**
the row. **This divergence is deliberate and is not a leftover to clean
up**: each is a different contract with a different caller.

- Orders: the order screen has no fallback for a status it cannot display,
  so an unknown code should fail loudly in the request.
- Payouts: reconciliation must not stop on a code nobody has seen yet; the
  record goes to `unresolved`.
- Reporting: the CSV must not grow a status value that breaks finance's
  sheets, and a row it cannot classify is simply not reported.

Before anyone unifies these, at minimum check:

- what the order screen's consumers accept today when an unknown code
  makes the request throw (a visible failure is the current behaviour),
- whether anything consumes `Reconciliation.unresolved` in a way that
  assumes it contains only unknown codes,
- whether finance's sheets would break on a new status value or on rows
  that used to be silently skipped now appearing.

Until all three checks are done and agreed on, the divergence stays.
