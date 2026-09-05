# 06-NOTES.md

## reasoning

```
The task is to write exactly one file: `NOTES.md`. According to the plan, this file should "Document the three divergent unknown-code behaviors and the legacyReportCasing quirk."

Let me look at what the plan says about NOTES.md:
- Location: Repository root (`NOTES.md`)
- Purpose: "Documents the three divergent unknown-code behaviors and the legacyReportCasing quirk"

From the plan's control flow section, I can see the three divergent behaviors:
1. Orders service: always throws on unknown
2. Payouts service: returns `'unknown'` on unknown (the plan says "returns 'unknown'" but then notes it might be a different literal - looking at the plan more carefully, it says `unknownPolicy: 'fallback', fallbackValue: 'refunded'` but then has a note saying "the payouts fallback value is whatever string the existing code returns for unknown — the implementer reads the fixture to confirm; listed here as 'refunded' as a placeholder matching the "return 'unknown'" description. If the fixture shows a different literal, use that.")

Wait, looking more carefully at the plan:
- The variant description says: "Unknown provider codes: today each copy behaves differently (throw / return 'unknown' / silently skip)."
- The plan says payouts uses `fallbackValue: 'refunded'` but with a note that it's a placeholder.

Actually, re-reading the variant description: "throw / return 'unknown' / silently skip" - so the three behaviors are:
1. Orders: throw
2. Payouts: return 'unknown'
3. Reporting: silently skip

And the legacyReportCasing quirk: when `legacyReportCasing` is true, `'completed'` becomes `'COMPLETED'`.

Now let me write the NOTES.md. It should be a markdown document (not TypeScript), documenting these divergences. The plan says "document the divergence in NOTES.md — do NOT unify it."

Let me write a clear, complete NOTES.md that:
1. Documents the three divergent unknown-code behaviors (throw / return 'unknown' / silently skip)
2. Documents the legacyReportCasing quirk
3. References where each behavior lives and how it's preserved via the mapper API

I should not reproduce code from the reference files. I should write documentation that stands on its own.

Let me think about the format. It's a markdown file at the repository root. It should be concise but complete. Let me structure it:

- Title
- Section on the three divergent unknown-code behaviors
- Section on the legacyReportCasing quirk
- Maybe a note that these are intentional and should not be unified

Let me write it now.
```

## reply

```markdown
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
```
