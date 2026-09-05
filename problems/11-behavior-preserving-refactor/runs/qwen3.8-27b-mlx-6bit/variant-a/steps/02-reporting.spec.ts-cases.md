# 02-reporting.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/reporting.spec.ts` based on the PLAN.md and the implementation files. I need to understand what the reporting service does and what the characterization tests should pin.

Let me analyze:

1. The reporting service uses `PaymentStatusMapper` with `{ unknownPolicy: 'skip', legacyReportCasing: true }`.
2. The characterization tests must pin the reporting copy's current output for ALL statuses (including the quirk).
3. The reporting call site skips unknown codes (omits them from output).

Looking at the implementation:
- `map(providerCode)` returns `string | undefined`
- For known codes: returns the mapped status, with `'COMPLETED'` if `legacyReportCasing` is true and the mapped value is `'completed'`
- For unknown codes with `skip` policy: returns `undefined`
- The reporting service filters out `undefined` results before writing to CSV

Now, the task says: "Write characterization tests for the reporting copy first, pinning its current output for all statuses (including the quirk)."

The plan's test table lists:
1. maps `'pending'` → `'pending'`
2. maps `'completed'` → `'COMPLETED'` (the quirk)
3. maps `'failed'` → `'failed'`
4. maps `'refunded'` → `'refunded'`
5. maps an unknown code → returns nothing / skips
6. maps `'payout_initiated'` → `'pending'` (union table)

But wait - these are tests for the mapper itself? Or for the reporting service? The task says "characterization tests for the reporting copy". The reporting copy is the reporting service. So these tests should exercise the reporting service's behavior.

Actually, looking more carefully at the plan: "Test (file `test/reporting.spec.ts`)" - these tests are in the reporting spec file. They test the reporting service's behavior (which now delegates to the mapper).

Let me think about what branches could be wrong:

1. The basic mappings (pending, failed, refunded) - each is a branch in the STATUS_TABLE
2. The quirk: completed → COMPLETED (legacyReportCasing option)
3. The skip behavior: unknown code → undefined (filtered out by reporting service)
4. Payout-specific codes in the union table: payout_initiated → pending, payout_settled → completed
5. What about payout_settled with legacyReportCasing? It maps to 'completed', so it should become 'COMPLETED' too.
6. The constructor validation: fallbackValue required when unknownPolicy is 'fallback' - but reporting uses 'skip', so this isn't relevant to reporting tests directly.

Wait, let me reconsider. The tests are for `test/reporting.spec.ts`. They test the reporting service. But the plan says these are "characterization tests for the reporting copy, pinning its current output for all statuses."

The key behaviors to pin:
1. Each known status maps correctly (pending, failed, refunded stay lowercase)
2. The quirk: completed → COMPLETED (not 'completed')
3. Unknown codes are skipped (not included in output)
4. Payout codes work in the union table (payout_initiated → pending, payout_settled → completed)
5. payout_settled with legacyReportCasing → 'COMPLETED' (since it maps to 'completed')

Awkward cases:
- What about an empty string as provider code? It's not in the table, so it should be skipped.
- What about a code that looks like a status but with different casing? e.g., 'Pending' vs 'pending'. The table uses lowercase, so 'Pending' would be unknown → skipped.
- What about the reporting service's output format when ALL codes are unknown? The result should be an empty array.
- What about duplicate codes in the input?

Let me think about what "would have to be broken for it to fail":

1. `maps 'pending' to 'pending'` — fails if the STATUS_TABLE entry for 'pending' is removed or changed, or if legacyReportCasing incorrectly affects non-completed statuses
2. `maps 'completed' to 'COMPLETED' (legacy quirk)` — fails if legacyReportCasing is not applied, or is applied to the wrong status
3. `maps 'failed' to 'failed'` — fails if STATUS_TABLE entry is removed/changed
4. `maps 'refunded' to 'refunded'` — fails if STATUS_TABLE entry is removed/changed
5. `skips unknown provider codes` — fails if the skip policy is not implemented, or if unknown codes produce an error instead
6. `maps 'payout_initiated' to 'pending'` — fails if the union table doesn't include payouts-specific codes
7. `maps 'payout_settled' to 'COMPLETED'` — fails if legacyReportCasing doesn't apply to payout_settled (which maps to 'completed'), OR if the union table is missing this code

Wait, actually I need to be more careful. The tests are for the reporting service. Let me think about what the reporting service actually does:

The reporting service takes some input (a list of provider codes?), maps each one, filters out undefineds, and produces output (CSV rows or an array of statuses).

The characterization tests should pin the reporting service's output for various inputs.

Let me also consider:
- The error path that looks like success: what if an unknown code somehow gets through and produces a string instead of being filtered?
- Boundary: empty input (no codes) → empty output
- The quirk specifically: only 'completed' becomes 'COMPLETED', not other statuses

Let me also think about what I'm NOT testing:
- The 'throw' policy (orders) and 'fallback' policy (payouts) — those are tested in their own spec files
- The mapper's internal implementation details (STATUS_TABLE structure)
- NestJS module wiring
- CSV file I/O (that's beyond the mapping behavior)

Now let me format these properly.
```

## reply

- `maps 'pending' to 'pending'` — Proves the base passthrough for a non-quirked status. Fails if the `STATUS_TABLE` entry for `'pending'` is removed, retyped, or if `legacyReportCasing` is erroneously applied to every status instead of only `'completed'`.

- `maps 'completed' to 'COMPLETED' (legacy casing quirk)` — Proves the reporting-specific upper-casing is preserved. Fails if `legacyReportCasing` is not set on the reporting mapper instance, if the casing check compares against the wrong literal (e.g. `'Pending'`), or if the check is applied before the table lookup so it corrupts an unknown code.

- `maps 'failed' to 'failed'` — Proves a second non-quirked status passes through unchanged. Fails if the `STATUS_TABLE` entry is removed, or if a blanket `.toUpperCase()` was applied to all results instead of a targeted check on `'completed'`.

- `maps 'refunded' to 'refunded'` — Proves the fourth base status. Fails if the `STATUS_TABLE` entry is missing or if the fallback path is accidentally triggered for a known code (e.g. a typo in the key).

- `skips an unknown provider code (not present in output)` — Proves the reporting call site silently drops codes not in the union table. Fails if `unknownPolicy` is set to `'throw'` or `'fallback'` on the reporting mapper, if the `undefined`-filtering step is removed from the service, or if the table lookup uses a case-insensitive match that accidentally "finds" the unknown code.

- `skips all codes when none are recognised (empty result)` — Boundary/exhaustion: proves the service produces an empty array rather than a singleton `undefined` or throwing. Fails if the filter uses `.filter(Boolean)` incorrectly (e.g. also drops a legitimate empty-string status) or if the service iterates with `forEach` and pushes before checking for `undefined`.

- `maps 'payout_initiated' to 'pending' (union table coverage)` — Proves the mapper's union includes payouts-specific codes so the reporting flow does not skip them. Fails if the `STATUS_TABLE` only contains the four base codes and the payouts entries were omitted during extraction.

- `maps 'payout_settled' to 'COMPLETED' (union + quirk interaction)` — Proves that a payouts-specific code resolving to `'completed'` also receives the legacy casing, not just the base `'completed'` key. Fails if the `legacyReportCasing` check is performed on the *input* string (`providerCode === 'completed'`) rather than on the *mapped output*, so `payout_settled` escapes the quirk.

- `does not apply legacy casing to 'payout_initiated' (which maps to 'pending')` — Proves the quirk is scoped to `'completed'` results only and does not over-cast a payouts code that resolves to a different status. Fails if the casing logic is "apply when `legacyReportCasing` is true and the code is in the payouts subset" or some other broader condition.

- `treats a differently-cased known code (e.g. 'Pending') as unknown and skips it` — Boundary: the table keys are lowercase; a provider code with altered casing must not match. Fails if a `.toLowerCase()` or case-insensitive lookup was introduced in the table reference, silently "fixing" a code the legacy reporting pipeline would have dropped.

- `does not throw or log for an unknown code (silent skip, not error path)` — The error-path-that-looks-like-success: proves the reporting flow's unknown-code handling is indistinguishable from a short input. Fails if `unknownPolicy` defaults to `'throw'` when omitted, or if a `try/catch` in the service swallows a `TypeError` but still pushes a placeholder string into the output.

Deliberately **not** testing here: the `'throw'` (orders) and `'fallback'` (payouts) unknown-code policies, the constructor validation for missing `fallbackValue`, NestJS module wiring or DI, and CSV file I/O — those are pinned by `test/orders.spec.ts`, `test/payouts.spec.ts`, integration tests, and are outside the reporting call site's behavioural contract.
